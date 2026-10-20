import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { LOCAL_MODE } from "@/lib/local/mode";
import { siteUrl } from "@/lib/site-url";
import { forgetTokens } from "@/lib/xtiles/tokens";

/**
 * Forget a member's xTiles connection. EchoMe stops being able to read or write
 * their workspace at once; what is already in xTiles is theirs and untouched.
 * (They can also remove EchoMe's access from xTiles itself at any time.)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await currentUser();
  const base = await siteUrl();
  if (!user) return NextResponse.redirect(`${base}/login?next=/account`, { status: 303 });
  if (!LOCAL_MODE) await forgetTokens(user.id);
  return NextResponse.redirect(`${base}/account?xtiles=disconnected`, { status: 303 });
}
