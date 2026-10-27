import { NextResponse } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { NOT_SIGNED_IN } from "@/lib/echo/messages";
import { consume } from "@/lib/rate-limit";
import { xtiles } from "@/lib/xtiles/factory";
import { McpError } from "@/lib/xtiles/mcp";

/**
 * The EchoHub, for the closing screen. Before someone is asked what to keep, it
 * is worth knowing there is somewhere to keep it; and if there isn't, they can
 * set it up right there instead of finding out when the save fails.
 *
 *   GET   is there an EchoHub in their xTiles?
 *   POST  set one up from the template (only when there is none, and only when
 *         they press the button: nothing is created behind their back)
 *
 * Answers are one word. What is logged is the kind of failure, never a name or a
 * page of their workspace.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type HubStatus = "ready" | "no-hub" | "not-connected" | "unknown";

/** A slow xTiles must not hold the closing screen up: any doubt is "unknown". */
const CHECK_TIMEOUT_MS = 6000;

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: NOT_SIGNED_IN }, { status: 401 });

  const adapter = await xtiles();
  if (!(await adapter.isConnected(user.id).catch(() => false))) {
    return NextResponse.json({ status: "not-connected" satisfies HubStatus });
  }

  const status = await Promise.race([
    adapter.checkWorkspace(user.id),
    new Promise<"unknown">((resolve) => setTimeout(() => resolve("unknown"), CHECK_TIMEOUT_MS)),
  ]).catch(() => "unknown" as const);
  return NextResponse.json({ status: status satisfies HubStatus });
}

export async function POST() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: NOT_SIGNED_IN }, { status: 401 });

  const verdict = await consume("hub", user.id);
  if (!verdict.allowed) {
    return NextResponse.json(
      { status: "failed" },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
    );
  }

  const adapter = await xtiles();
  if (!(await adapter.isConnected(user.id).catch(() => false))) {
    return NextResponse.json({ status: "not-connected" }, { status: 409 });
  }

  try {
    // A hub that turns out to exist already is left alone: the adapter looks first.
    const result = await adapter.createHub(user.id);
    return NextResponse.json({ status: result });
  } catch (error) {
    const reason =
      error instanceof McpError
        ? `${error.kind}: ${error.message.replace(/\):.*$/s, ")")}`
        : error instanceof Error
          ? error.name
          : "Error";
    console.warn(`[xtiles] hub setup failed — ${reason}`);
    return NextResponse.json({ status: "failed" }, { status: 502 });
  }
}
