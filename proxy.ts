import { NextResponse, type NextRequest } from "next/server";

import { LOCAL_MODE } from "@/lib/local/mode";
import { updateSession } from "@/lib/supabase/session";
import { localGate } from "@/lib/local/gate";

/**
 * Next 16 renamed the middleware convention to `proxy`. The behaviour is
 * unchanged: refresh the session on every request and gate the *pages* of the
 * app.
 *
 * In local mode there is no Supabase session to refresh, so the whole Supabase
 * path is skipped rather than called with credentials that do not exist.
 *
 * API routes are matched OUT below, on purpose. Every route under app/api/
 * already checks its own auth — currentUser() for the user-facing ones,
 * CRON_SECRET for the nudge job, the Stripe signature for the webhook — so
 * gating them here a second time only breaks the callers that have no browser
 * session at all. A redirect to /login is a 307 by default, which is exactly
 * what a caller with no cookie (Stripe's webhook, the cron job) got: the
 * request never reached the route, redirected before its own check ran.
 */
export default async function proxy(request: NextRequest) {
  if (LOCAL_MODE) return localGate(request);
  return updateSession(request);
}

export const config = {
  matcher: [
    // Everything except API routes, static assets and image optimisation.
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
