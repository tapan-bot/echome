import { NextResponse, type NextRequest } from "next/server";

import { localUserFromCookieValue } from "@/lib/local/auth";
import { LOCAL_MODE } from "@/lib/local/mode";

/**
 * The local-mode stand-in for Supabase session refresh.
 *
 * There is no token to refresh — the cookie either names someone or it does
 * not. The redirect behaviour matches the real gate exactly, so what you test
 * locally is the same flow you get in production.
 *
 * Optionally (ECHOME_LOCAL_AUTOLOGIN=1) a visitor with no cookie is signed in as
 * the preview account instead of being sent to the login screen, so the app can
 * be opened and looked at without typing anything. Local mode only: this file is
 * reached only when ECHOME_LOCAL_MODE=1, which already refuses to run on Vercel
 * or in production, and the check below says so again rather than assume it.
 */

const PUBLIC_PATHS = ["/login", "/signup", "/reset", "/auth"];
const COOKIE = "echome_local_email";
export const AUTOLOGIN_EMAIL = "preview@example.com";

export function localGate(request: NextRequest) {
  let email = request.cookies.get(COOKIE)?.value;
  let signedInAutomatically = false;

  if (!email && LOCAL_MODE && process.env.ECHOME_LOCAL_AUTOLOGIN === "1") {
    email = AUTOLOGIN_EMAIL;
    signedInAutomatically = true;
    // So the page being rendered on THIS request already sees them as signed in.
    request.cookies.set(COOKIE, email);
  }

  const user = localUserFromCookieValue(email);
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  /** Hand the browser the cookie too, so the next request has it. */
  const remember = (response: NextResponse) => {
    if (signedInAutomatically && email) {
      response.cookies.set(COOKIE, email, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }
    return response;
  };

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    url.search = "";
    return remember(NextResponse.redirect(url));
  }

  return remember(NextResponse.next({ request }));
}
