import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { classifyError } from "@/lib/echo/telemetry";
import { LOCAL_MODE } from "@/lib/local/mode";
import { siteUrl } from "@/lib/site-url";
import { authorizeUrl, newState, pkcePair, registerClient, XTilesAuthError } from "@/lib/xtiles/oauth";
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_MAX_AGE_SECONDS,
  sealOAuthState,
} from "@/lib/xtiles/oauth-state";

/**
 * Begins connecting a member's xTiles.
 *
 * EchoMe registers itself with xTiles for this sign-in (nobody at xTiles has to
 * do anything), then sends the member to xTiles' own page to sign in and click
 * Allow. Their xTiles password is never entered here. What must survive the
 * trip — a one-time secret and a value proving the return is ours — rides in a
 * short-lived sealed cookie.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await currentUser();
  const base = await siteUrl();
  if (!user) return NextResponse.redirect(`${base}/login?next=/account`, { status: 303 });

  // Local mode uses a stand-in workspace that is always connected.
  if (LOCAL_MODE) return NextResponse.redirect(`${base}/account`, { status: 303 });

  try {
    const redirectUri = `${base}/api/xtiles/callback`;
    const clientId = await registerClient(redirectUri);
    const { verifier, challenge } = pkcePair();
    const state = newState();
    const url = await authorizeUrl({ clientId, redirectUri, state, challenge });

    const response = NextResponse.redirect(url, { status: 303 });
    response.cookies.set(
      OAUTH_COOKIE,
      sealOAuthState(user.id, {
        state,
        verifier,
        clientId,
        redirectUri,
        exp: Date.now() + OAUTH_COOKIE_MAX_AGE_SECONDS * 1000,
      }),
      {
        httpOnly: true,
        secure: base.startsWith("https:"),
        // Lax, not Strict: the browser arrives back from xTiles on a top-level
        // navigation, and Strict would withhold the cookie from exactly that.
        sameSite: "lax",
        path: "/api/xtiles",
        maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
      },
    );
    return response;
  } catch (error) {
    const label = error instanceof XTilesAuthError ? `${error.name}:${error.code}` : classifyError(error);
    console.error(`[xtiles] connect failed: ${label}`);
    return NextResponse.redirect(`${base}/account?xtiles=error`, { status: 303 });
  }
}
