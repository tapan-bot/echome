import { NextResponse, type NextRequest } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { classifyError } from "@/lib/echo/telemetry";
import { siteUrl } from "@/lib/site-url";
import { exchangeCode, XTilesAuthError } from "@/lib/xtiles/oauth";
import { OAUTH_COOKIE, openOAuthState, statesMatch } from "@/lib/xtiles/oauth-state";
import { saveTokens } from "@/lib/xtiles/tokens";
import { xtiles } from "@/lib/xtiles/factory";

/**
 * The return trip from xTiles' sign-in page.
 *
 * Three things must all hold before anything is saved: the person is signed in
 * to EchoMe, the sealed cookie we set when they left is present and theirs, and
 * the state xTiles echoes back matches the one inside it. Anything else is
 * treated as someone else's request.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const base = await siteUrl();
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${base}/login?next=/account`, { status: 303 });

  const finish = (status: string) => {
    const response = NextResponse.redirect(`${base}/account?xtiles=${status}`, { status: 303 });
    // Single use, whatever happened.
    response.cookies.set(OAUTH_COOKIE, "", { path: "/api/xtiles", maxAge: 0 });
    return response;
  };

  const params = request.nextUrl.searchParams;
  // They pressed "Deny", or xTiles refused. Not an error on our side.
  if (params.get("error")) return finish("denied");

  const code = params.get("code");
  const state = params.get("state");
  const sealed = openOAuthState(user.id, request.cookies.get(OAUTH_COOKIE)?.value);
  if (!code || !state || !sealed || !statesMatch(state, sealed.state)) return finish("error");

  try {
    const tokens = await exchangeCode({
      code,
      verifier: sealed.verifier,
      clientId: sealed.clientId,
      redirectUri: sealed.redirectUri,
    });
    await saveTokens(user.id, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      workspaceId: null,
      clientId: sealed.clientId,
      projectId: null,
    });
  } catch (error) {
    const label = error instanceof XTilesAuthError ? `${error.name}:${error.code}` : classifyError(error);
    console.error(`[xtiles] sign-in failed: ${label}`);
    return finish("error");
  }

  // Connected. Is the EchoHub template there yet? Failing to ask is not a failure
  // to connect: the next conversation will find out for itself.
  try {
    return finish((await (await xtiles()).checkWorkspace(user.id)) === "ready" ? "connected" : "nohub");
  } catch {
    return finish("connected");
  }
}
