import { NextResponse, type NextRequest } from "next/server";
import { APIConnectionError, APIError, RateLimitError } from "@anthropic-ai/sdk";

import { DecryptionError, SessionKeyDestroyedError } from "@/lib/echo/crypto";
import {
  GENERIC_ERROR,
  NOT_SIGNED_IN,
  RATE_LIMITED,
  SESSION_CLOSED,
  SESSION_UNREADABLE,
  UPSTREAM_UNAVAILABLE,
} from "@/lib/echo/messages";
import { sessionStore } from "@/lib/echo/store-factory";
import { appendMessages, attachMemory, resumeOrStartSession } from "@/lib/echo/sessions";
import { classifyError, emptyMetrics, recordTurn } from "@/lib/echo/telemetry";
import { speak } from "@/lib/echo/voice";
import { accessFor, startFreeWeek } from "@/lib/billing/entitlements";
import { recordFlag, shouldSurfaceResources, watch } from "@/lib/echo/watchman";
import { consume } from "@/lib/rate-limit";
import { speakLocally } from "@/lib/local/voice";
import { LOCAL_MODE } from "@/lib/local/mode";
import { currentUser } from "@/lib/auth/current-user";
import { xtiles } from "@/lib/xtiles/factory";

/** node:crypto is used to decrypt the session, so this cannot run on Edge. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One conversational turn.
 *
 * Ordering that matters: the user's message is encrypted and persisted BEFORE
 * Claude is called. If the model is down, they still have their own words when
 * they come back — losing what somebody wrote while thinking is worse than
 * making them wait.
 *
 * The response is newline-delimited JSON rather than SSE. It carries structured
 * events (text, refusal, error, done) which SSE's text-only frames would make
 * clumsier, and fetch + ReadableStream reads it directly.
 */

type WireEvent =
  | { t: "text"; v: string }
  /** The watchman flagged this message. The interface surfaces resources. */
  | { t: "flag"; v: string }
  | { t: "refusal"; v: string }
  | { t: "error"; v: string }
  | { t: "done" };

const MAX_MESSAGE_CHARS = 20_000;

/** Reading their xTiles must never keep someone waiting long for a first reply. */
const MEMORY_TIMEOUT_MS = 6_000;

/**
 * What this person keeps in their xTiles, or null. Never throws: if xTiles is
 * slow, down, disconnected or confused, the conversation simply begins without
 * it, which is exactly how it behaved before there was a connection at all.
 * Nothing about the content is logged; only the kind of failure.
 */
async function readMemory(userId: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const adapter = await xtiles();
    if (!(await adapter.isConnected(userId))) return null;
    return await Promise.race([
      adapter.readMemory(userId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), MEMORY_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    console.error(`[chat] xTiles memory unavailable: ${classifyError(error)}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: NOT_SIGNED_IN }, { status: 401 });

  let text: unknown;
  try {
    ({ text } = await request.json());
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }
  if (text.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: "That's longer than I can take in one go. Try sending it in pieces." },
      { status: 413 },
    );
  }

  // Rate limit before anything expensive. Fails open — see lib/rate-limit.ts.
  const verdict = await consume("chat", user.id);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: RATE_LIMITED },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterSeconds) } },
    );
  }

  // Has this person paid, or are they still in their free week?
  const access = await accessFor(user.id);
  if (!access.allowed) {
    return NextResponse.json(
      {
        error:
          access.reason === "lapsed"
            ? "Your access has lapsed. You can restart it from your account page."
            : "Your free week has ended. Choosing a plan keeps the conversation going.",
        needsPurchase: true,
        reason: access.reason,
      },
      { status: 402 },
    );
  }

  const store = await sessionStore();

  let session;
  try {
    session = await resumeOrStartSession(store, user.id);
  } catch (error) {
    if (error instanceof SessionKeyDestroyedError) {
      return NextResponse.json({ error: SESSION_CLOSED }, { status: 410 });
    }
    if (error instanceof DecryptionError) {
      return NextResponse.json({ error: SESSION_UNREADABLE }, { status: 500 });
    }
    console.error(`[chat] could not open session: ${classifyError(error)}`);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  // The first message of a conversation: read what they keep in their own xTiles,
  // once. It is held only inside the encrypted session, so it goes when the
  // conversation does. Later turns reuse it without asking xTiles again.
  let transcript = session.transcript;
  if (transcript.memory === undefined && transcript.messages.length === 0) {
    transcript = await attachMemory(store, session.row, transcript, (await readMemory(user.id)) ?? "");
  }

  // Persist their words first. Everything after this point can fail without
  // costing them anything.
  const withUserTurn = await appendMessages(store, session.row, transcript, {
    role: "user",
    content: text,
  });

  // Their first message begins the free week. Failing to record that is no reason to fail the turn.
  if (access.reason === "free-trial" && access.trialStartedAt === null) {
    await startFreeWeek(user.id).catch((error) =>
      console.warn(`[billing] could not start the free week — ${classifyError(error)}`),
    );
  }

  // The watchman runs alongside the turn, never in front of it. A person mid
  // thought is not made to wait on a safety classifier, and a classifier
  // outage must never silence someone reaching out.
  const watchman = watch(text)
    .then(async (category) => {
      await recordFlag(user.id, session.row.id, category);
      return category;
    })
    .catch(() => "none" as const);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: WireEvent) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        // Surfaced as soon as the classifier answers, without holding up the
        // reply. It never blocks and never rewrites — it only adds.
        void watchman.then((category) => {
          if (shouldSurfaceResources(category)) send({ t: "flag", v: category });
        });

        // Local mode with no API key falls back to a canned responder, so the
        // whole conversation path can be exercised with no credentials at all.
        // A real key is always preferred, even locally.
        const turn =
          LOCAL_MODE && !process.env.ANTHROPIC_API_KEY
            ? speakLocally(withUserTurn.messages)
            : speak(withUserTurn.messages, { signal: request.signal, memory: withUserTurn.memory });

        for await (const event of turn) {
          switch (event.type) {
            case "text":
              send({ t: "text", v: event.text });
              break;

            case "refusal":
              // Not an error. The client swaps the partial bubble for this.
              send({ t: "refusal", v: event.text });
              break;

            case "done": {
              if (event.assistantMessage) {
                await appendMessages(store, session.row, withUserTurn, event.assistantMessage);
              }
              await recordTurn(user.id, session.row.id, event.metrics);
              send({ t: "done" });
              break;
            }

            case "error": {
              await recordTurn(user.id, session.row.id, event.metrics);
              send({ t: "error", v: userFacing(event.error) });
              break;
            }
          }
        }
      } catch (error) {
        // A failure in persistence or the stream itself. The user's own message
        // is already saved, so this costs them the reply and nothing more.
        const errorClass = classifyError(error);
        console.error(`[chat] turn failed: ${errorClass}`);
        await recordTurn(user.id, session.row.id, {
          ...emptyMetrics(0),
          errorClass,
        });
        send({ t: "error", v: userFacing(error) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Vercel and most proxies buffer without this, which would defeat the
      // point of streaming.
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Map a failure to something worth reading. Deliberately never includes the
 * upstream message — API error bodies can echo the request, and the request is
 * the conversation.
 */
function userFacing(error: unknown): string {
  if (error instanceof RateLimitError) return RATE_LIMITED;
  if (error instanceof APIConnectionError) return UPSTREAM_UNAVAILABLE;
  if (error instanceof APIError) return UPSTREAM_UNAVAILABLE;
  if (error instanceof SessionKeyDestroyedError) return SESSION_CLOSED;
  if (error instanceof DecryptionError) return SESSION_UNREADABLE;
  return GENERIC_ERROR;
}
