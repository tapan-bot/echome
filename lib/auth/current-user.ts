import "server-only";

import { cache } from "react";

import { getLocalUser } from "@/lib/local/auth";
import { LOCAL_MODE } from "@/lib/local/mode";
import { getUser as getSupabaseUser } from "@/lib/supabase/server";

/**
 * The signed-in person, from whichever authority is in charge.
 *
 * Every page and route asks this rather than Supabase directly, so local mode
 * is one branch in one file instead of a condition scattered through the app.
 *
 * Wrapped in React's cache() so that within one request, calling this from
 * several places — a page, the account menu mounted alongside it in the root
 * layout, a nested component — costs one auth check, not one each. Safe in
 * Route Handlers too: Next backs cache() with the same request-scoped storage
 * there as it does for Server Components, so nothing here can leak between
 * requests or between users.
 */

export interface CurrentUser {
  readonly id: string;
  readonly email: string | null;
}

export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  if (LOCAL_MODE) {
    const local = await getLocalUser();
    return local ? { id: local.id, email: local.email } : null;
  }

  const user = await getSupabaseUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
});
