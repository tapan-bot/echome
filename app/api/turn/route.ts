import { NextResponse, type NextRequest } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { GENERIC_ERROR, NOT_SIGNED_IN } from "@/lib/echo/messages";
import { TurnError, commitTurn, proposeTurn, turnStatus } from "@/lib/echo/pageturn";
import { parseTurnSummary, type TurnSummary } from "@/lib/echo/turn";
import { consume } from "@/lib/rate-limit";
import { xtiles } from "@/lib/xtiles/factory";

/**
 * Turn the Page.
 *
 *   GET            how many conversations the EchoMap holds, and whether the page can be turned
 *   POST propose   read the trail, write the summary and send it back. Nothing is saved.
 *   POST commit    only with the summary the person approved: start the next EchoHub
 *
 * Nothing the person's entries say is stored or logged here.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function failure(error: unknown) {
  if (error instanceof TurnError) {
    const status = error.kind === "not-due" ? 409 : error.kind === "not-connected" || error.kind === "no-hub" ? 422 : 502;
    return NextResponse.json({ error: error.message, kind: error.kind }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ error: GENERIC_ERROR }, { status: 500, headers: NO_STORE });
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: NOT_SIGNED_IN }, { status: 401 });
  try {
    return NextResponse.json(await turnStatus(await xtiles(), user.id), { headers: NO_STORE });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: NOT_SIGNED_IN }, { status: 401 });

  let body: { action?: unknown; summary?: unknown; timeZone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const verdict = await consume("turn", user.id);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: "Give it a moment before trying again." },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(verdict.retryAfterSeconds) } },
    );
  }

  const adapter = await xtiles();

  if (body.action === "propose") {
    try {
      return NextResponse.json(await proposeTurn(adapter, user.id), { headers: NO_STORE });
    } catch (error) {
      return failure(error);
    }
  }

  if (body.action === "commit") {
    // The summary is what the person approved on screen. It is checked for shape, and its
    // "words worth keeping" are kept as they are because the source is not re-read here.
    let summary: TurnSummary;
    try {
      summary = parseTurnSummary(body.summary, JSON.stringify(body.summary ?? ""));
    } catch {
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 400, headers: NO_STORE });
    }
    const timeZone = typeof body.timeZone === "string" && body.timeZone.length < 64 ? body.timeZone : undefined;
    try {
      return NextResponse.json(await commitTurn(adapter, user.id, summary, { timeZone }), { headers: NO_STORE });
    } catch (error) {
      return failure(error);
    }
  }

  return NextResponse.json({ error: GENERIC_ERROR }, { status: 400, headers: NO_STORE });
}
