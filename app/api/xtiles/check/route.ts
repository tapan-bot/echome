import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { siteUrl } from "@/lib/site-url";
import { xtiles } from "@/lib/xtiles/factory";

/**
 * "Check again": after a member adds the EchoHub template, is it there now?
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await currentUser();
  const base = await siteUrl();
  if (!user) return NextResponse.redirect(`${base}/login?next=/account`, { status: 303 });

  try {
    const ready = (await (await xtiles()).checkWorkspace(user.id)) === "ready";
    return NextResponse.redirect(`${base}/account?xtiles=${ready ? "connected" : "nohub"}`, { status: 303 });
  } catch {
    return NextResponse.redirect(`${base}/account?xtiles=error`, { status: 303 });
  }
}
