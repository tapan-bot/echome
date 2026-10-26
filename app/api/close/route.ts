import { NextResponse, type NextRequest } from "next/server";

import { currentUser } from "@/lib/auth/current-user";
import { sessionStore } from "@/lib/echo/store-factory";
import { GENERIC_ERROR, NOT_SIGNED_IN } from "@/lib/echo/messages";
import {
  abandonClosing,
  commitClosing,
  proposeClosing,
  RitualError,
} from "@/lib/echo/ritual";
import { parseDistillation } from "@/lib/echo/schema";
import { classifyError } from "@/lib/echo/telemetry";
import { consume } from "@/lib/rate-limit";
import { xtiles } from "@/lib/xtiles/factory";

/**
 * The closing ritual's endpoint.
 *
 *   propose  distil the conversation and show what was drawn out
 *   commit   write the kept fields as one dated EchoMap entry, then destroy the session
 *   abandon  put the conversation back
 *
 * Note what commit accepts: the distillation is sent back from the client along
 * with the kept ids. That is deliberate — it means the transcript is not
 * decrypted a second time, and the distillation is never persisted anywhere
 * between the two steps.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The moment the person reached "what to keep", as they sent it, so that a retry
 * after a failed save writes the same heading. It is only the label on their own
 * entry, but a time far from now is not believed: anything unreadable, in the
 * future, or more than two days old is replaced by the server's own clock.
 */
function entryTime(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const sent = new Date(value);
  const age = Date.now() - sent.getTime();
  return Number.isNaN(age) || age < -5 * 60_000 || age > 48 * 3_600_000 ? undefined : sent;
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: NOT_SIGNED_IN }, { status: 401 });

  let body: {
    action?: unknown;
    keptIds?: unknown;
    distillation?: unknown;
    sessionId?: unknown;
    timeZone?: unknown;
    enteredAt?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const store = await sessionStore();

  try {
    if (body.action === "propose") {
      const verdict = await consume("ritual", user.id);
      if (!verdict.allowed) {
        return NextResponse.json(
          { error: "Give it a minute before trying that again." },
          { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
        );
      }
      const proposal = await proposeClosing(store, user.id);
      return NextResponse.json(proposal);
    }

    if (body.action === "abandon") {
      await abandonClosing(store, user.id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "commit") {
      if (typeof body.sessionId !== "string" || !Array.isArray(body.keptIds)) {
        return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
      }
      const distillation = parseDistillation(body.distillation);
      const keptIds = body.keptIds.filter((id): id is string => typeof id === "string");

      const result = await commitClosing(
        store,
        await xtiles(),
        user.id,
        body.sessionId,
        keptIds,
        distillation,
        {
          timeZone: typeof body.timeZone === "string" ? body.timeZone : undefined,
          now: entryTime(body.enteredAt),
        },
      );
      return NextResponse.json({ ok: true, ...result });
    }

    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  } catch (error) {
    if (error instanceof RitualError) {
      // The conversation is intact in every one of these cases. The message
      // says so, because that is the thing the person most needs to know.
      return NextResponse.json(
        { error: error.message, kind: error.kind, retryable: error.retryable },
        { status: error.kind === "no-session" ? 404 : 503 },
      );
    }
    console.error(`[close] ritual failed: ${classifyError(error)}`);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
