import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { siteUrl } from "@/lib/site-url";
import { xtiles } from "@/lib/xtiles/factory";
import { McpError } from "@/lib/xtiles/mcp";

/**
 * Set up the member's EchoHub in their own xTiles, when they have none. They
 * press the button; nothing is ever created in their workspace behind their back.
 *
 * A second press, or a hub that turns out to exist already, creates nothing: the
 * adapter looks first. What is logged is the kind of failure only.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await currentUser();
  const base = await siteUrl();
  if (!user) return NextResponse.redirect(`${base}/login?next=/account`, { status: 303 });

  const adapter = await xtiles();
  if (!(await adapter.isConnected(user.id).catch(() => false))) {
    return NextResponse.redirect(`${base}/account?xtiles=error`, { status: 303 });
  }

  try {
    const result = await adapter.createHub(user.id);
    return NextResponse.redirect(
      `${base}/account?xtiles=${result === "created" ? "hubcreated" : "connected"}`,
      { status: 303 },
    );
  } catch (error) {
    const reason = error instanceof McpError ? `${error.kind}: ${error.message.replace(/\):.*$/s, ")")}` : error instanceof Error ? error.name : "Error";
    console.warn(`[xtiles] hub setup failed — ${reason}`);
    return NextResponse.redirect(`${base}/account?xtiles=hubfailed`, { status: 303 });
  }
}
