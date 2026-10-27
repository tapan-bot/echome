import "server-only";

import { randomUUID } from "node:crypto";

import { distill, DistillationFailedError } from "@/lib/echo/distill";
import { LOCAL_MODE } from "@/lib/local/mode";
import { createReceipt, markFailed, markWritten } from "@/lib/echo/receipts";
import {
  buildMapPage,
  countFields,
  formatEntryStamp,
  keepOnly,
  type Distillation,
} from "@/lib/echo/schema";
import { destroySession, readTranscript } from "@/lib/echo/sessions";
import { classifyError, recordTurn } from "@/lib/echo/telemetry";
import type { SessionStore } from "@/lib/echo/store";
import { XTilesWriteError, type XTilesAdapter } from "@/lib/xtiles/adapter";

/**
 * The closing ritual: how a conversation ends.
 *
 * THE ORDER IS THE SAFETY PROPERTY. From the build brief: "write the kept
 * material to their xTiles, then destroy the session key and delete the row —
 * in that order, and only after the write succeeds."
 *
 *   propose → distil, mark 'closing', show them what was drawn out
 *   commit  → write to xTiles, THEN destroy
 *   abandon → they changed their mind; put it back to 'open'
 *
 * If the write fails, the session is left exactly as it was. Destroying first
 * would mean a network blip erases somebody's conversation permanently, and
 * they would have no way of knowing what they had lost.
 */

export interface Proposal {
  readonly sessionId: string;
  readonly distillation: Distillation;
}

export type RitualFailure =
  | "no-session"
  | "distill-failed"
  | "not-connected"
  /** There is no EchoHub to write to; setting one up is the way forward. */
  | "hub-missing"
  /** xTiles refused the entry: the hub may have been deleted or moved. */
  | "hub-unusable"
  | "write-failed";

export class RitualError extends Error {
  override readonly name = "RitualError";
  constructor(
    message: string,
    readonly kind: RitualFailure,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

/**
 * Step one. Distil the open session and mark it 'closing'.
 *
 * 'closing' stops new turns — you cannot keep talking into a conversation you
 * are in the middle of ending — while leaving every byte recoverable.
 */
export async function proposeClosing(store: SessionStore, userId: string): Promise<Proposal> {
  // Resume a ritual already underway rather than starting a second one.
  const row = (await store.findOpen(userId)) ?? (await store.findClosing(userId));
  if (!row) {
    throw new RitualError("There is no open conversation to close.", "no-session", false);
  }

  const transcript = readTranscript(row);

  let distillation: Distillation;
  try {
    // Local mode with no API key uses a stub, so the whole ritual can be walked
    // through without credentials. A real key is always preferred.
    const result =
      LOCAL_MODE && !process.env.ANTHROPIC_API_KEY
        ? await (await import("@/lib/local/distill")).distillLocally(transcript)
        : await distill(transcript);
    distillation = result.distillation;
    await recordTurn(userId, row.id, result.metrics);
  } catch (error) {
    const reason = error instanceof DistillationFailedError ? error.reason : classifyError(error);
    await recordTurn(userId, row.id, {
      durationMs: 0,
      model: "claude-haiku-4-5",
      stopReason: null,
      errorClass: reason,
      inputTokens: null,
      outputTokens: null,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
    });
    // The session is untouched.
    throw new RitualError(
      "I couldn't draw this conversation together just now. Nothing has been lost — try again in a moment.",
      "distill-failed",
      true,
    );
  }

  if (row.status === "open") {
    await store.setStatus(row.id, userId, "closing");
  }
  return { sessionId: row.id, distillation };
}

/** They changed their mind. The conversation goes back to being open. */
export async function abandonClosing(store: SessionStore, userId: string): Promise<void> {
  const row = await store.findClosing(userId);
  if (row) await store.setStatus(row.id, userId, "open");
}

/**
 * Step two. Write what they kept, then destroy.
 *
 * Keeping nothing is a legitimate choice: there is no write to make, and the
 * conversation is still destroyed. That is their decision, honoured.
 */
export async function commitClosing(
  store: SessionStore,
  xtiles: XTilesAdapter,
  userId: string,
  sessionId: string,
  keptIds: readonly string[],
  distillation: Distillation,
  /** `timeZone` is the person's own, so the entry is dated on THEIR day. */
  options: { timeZone?: string; now?: Date } = {},
): Promise<{ ref: string | null; kept: number }> {
  const row = await store.find(sessionId, userId);
  if (!row) {
    throw new RitualError("That conversation is no longer open.", "no-session", false);
  }

  const kept = keepOnly(distillation, keptIds);
  const keptCount = countFields(kept);
  const receiptId = randomUUID();

  // Written before the destruction, so that if everything after this crashes
  // there is still a record that this conversation reached the ritual.
  await createReceipt({
    id: receiptId,
    userId,
    sessionId,
    // Always 0: the Compass is the person's own to write (skill v3.11, Section 7).
    // The column stays so the database needs no migration; mapItems counts the
    // fields drawn out of the conversation.
    compassItems: 0,
    mapItems: countFields(distillation),
    keptItems: keptCount,
  });

  let ref: string | null = null;

  if (kept.entry) {
    if (!(await xtiles.isConnected(userId))) {
      await markFailed(receiptId, "XTilesNotConnectedError");
      throw new RitualError(
        "Your xTiles workspace isn't connected, so there's nowhere to keep this yet. " +
          "Your conversation is safe and still here.",
        "not-connected",
        true,
      );
    }

    try {
      const page = buildMapPage(
        kept.entry,
        formatEntryStamp(options.now ?? new Date(), options.timeZone),
      );
      // The receipt id doubles as the idempotency key: a retry writes once.
      ref = (await xtiles.write(userId, page, receiptId)).ref;
    } catch (error) {
      const retryable = error instanceof XTilesWriteError ? error.retryable : true;
      // The reason is content-free (see toWriteError), so it can go on the receipt
      // and into the logs: without it "the write failed" cannot be told apart.
      const failure =
        error instanceof XTilesWriteError ? `XTilesWriteError: ${error.reason}` : classifyError(error);
      console.warn(`[ritual] xTiles write failed — ${failure}`);
      await markFailed(receiptId, failure);
      // THE SESSION IS NOT DESTROYED. This is the whole recovery path.
      const hubMissing = error instanceof XTilesWriteError && error.hubMissing;
      const hubRejected = error instanceof XTilesWriteError && error.hubRejected;
      if (hubRejected) {
        // Nothing is destroyed, and trying again is still allowed: the hub may be fine and xTiles
        // merely cross. A fresh one is offered beside it, for when it was deleted or moved.
        throw new RitualError(
          "xTiles wouldn't take this entry, so I haven't ended the conversation. Your EchoHub may have been " +
            "deleted or moved. You can try again, or set up a fresh one below. Your conversation is exactly " +
            "where you left it.",
          "hub-unusable",
          true,
        );
      }
      throw new RitualError(
        hubMissing
          ? "I couldn't find your EchoHub in your xTiles workspace, so I haven't ended the conversation. " +
              "You can set it up below and then try again. Your conversation is exactly where you left it."
          : "I couldn't write this to your xTiles just now, so I haven't ended the conversation. " +
              "It's exactly where you left it, and we can try again.",
        hubMissing ? "hub-missing" : "write-failed",
        // Trying again changes nothing until the hub exists, so the screen offers the setup instead.
        hubMissing ? false : retryable,
      );
    }
  }

  await markWritten(receiptId, ref);

  // Only now. The write succeeded, or there was nothing to write.
  await destroySession(store, sessionId, userId);

  return { ref, kept: keptCount };
}
