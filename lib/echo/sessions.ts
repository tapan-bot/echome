import "server-only";

import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";

import {
  decryptTranscript,
  destroyedKeyBytes,
  encryptTranscript,
  generateSessionKey,
  sessionAad,
  unwrapSessionKey,
  wrapSessionKey,
} from "@/lib/echo/crypto";
import {
  emptyTranscript,
  deserialiseTranscript,
  serialiseTranscript,
  withMessages,
  type Transcript,
} from "@/lib/echo/transcript";
import { SessionConflictError, type SessionRow, type SessionStore } from "@/lib/echo/store";

/**
 * The session lifecycle.
 *
 * Plaintext exists here for the duration of one request and nowhere else. It is
 * never returned to a caller that did not ask for it, never written to disk,
 * never logged, and never handed to an error message.
 */

export interface OpenSession {
  readonly row: SessionRow;
  readonly transcript: Transcript;
}

/**
 * Resume the user's open session, or start one. A user has at most one open
 * session, enforced both here and by a partial unique index in Postgres.
 */
export async function resumeOrStartSession(
  store: SessionStore,
  userId: string,
): Promise<OpenSession> {
  const existing = await store.findOpen(userId);
  if (existing) {
    return { row: existing, transcript: readTranscript(existing) };
  }

  const transcript = emptyTranscript();
  const sessionId = randomUUID();
  const sessionKey = generateSessionKey();
  const { nonce, ciphertext } = encryptTranscript(
    serialiseTranscript(transcript),
    sessionKey,
    sessionAad(sessionId, userId),
  );

  try {
    const row = await store.create({
      id: sessionId,
      userId,
      encryptedPayload: ciphertext,
      wrappedKey: wrapSessionKey(sessionKey),
      nonce,
    });
    return { row, transcript };
  } catch (error) {
    // Two tabs opened at once. Whoever lost the race just joins the winner.
    if (error instanceof SessionConflictError) {
      const winner = await store.findOpen(userId);
      if (winner) return { row: winner, transcript: readTranscript(winner) };
    }
    throw error;
  }
}

/**
 * A conversation left part-way through the closing ritual, with no open one
 * beside it: it was never finished and never put back. "Go back" and a failed
 * save put theirs back themselves, so what is found here is a leftover. It is the
 * person's own conversation, so it is never silently skipped (they would think it
 * lost) and never silently reopened (it may be old); the chat asks them.
 */
export async function findStranded(store: SessionStore, userId: string): Promise<SessionRow | null> {
  if (await store.findOpen(userId)) return null;
  return store.findClosing(userId);
}

/** They chose to pick it up: the most recent unfinished conversation becomes the open one. */
export async function reopenStranded(store: SessionStore, userId: string): Promise<boolean> {
  const stranded = await findStranded(store, userId);
  if (!stranded) return false;
  await store.setStatus(stranded.id, userId, "open");
  return true;
}

/** They chose to start fresh: every unfinished conversation is destroyed, for good. */
export async function discardStranded(store: SessionStore, userId: string): Promise<number> {
  let destroyed = 0;
  for (let stranded = await store.findClosing(userId); stranded; stranded = await store.findClosing(userId)) {
    await destroySession(store, stranded.id, userId);
    destroyed += 1;
  }
  return destroyed;
}

/** Decrypt a row into a transcript. Throws SessionKeyDestroyedError if closed. */
export function readTranscript(row: SessionRow): Transcript {
  const sessionKey = unwrapSessionKey(row.wrappedKey);
  const plaintext = decryptTranscript(
    row.encryptedPayload,
    row.nonce,
    sessionKey,
    sessionAad(row.id, row.userId),
  );
  return deserialiseTranscript(plaintext);
}

/**
 * Re-encrypt and persist. A fresh nonce every time — reusing a nonce under the
 * same key would break GCM's security outright.
 */
export async function saveTranscript(
  store: SessionStore,
  row: SessionRow,
  transcript: Transcript,
): Promise<void> {
  const sessionKey = unwrapSessionKey(row.wrappedKey);
  const { nonce, ciphertext } = encryptTranscript(
    serialiseTranscript(transcript),
    sessionKey,
    sessionAad(row.id, row.userId),
  );
  await store.savePayload(row.id, row.userId, { encryptedPayload: ciphertext, nonce });
}

/**
 * Record what was read from the person's xTiles at the start of this
 * conversation. Encrypted with the rest of the session; "" records that we
 * looked and found nothing, so we do not look again on every turn.
 */
export async function attachMemory(
  store: SessionStore,
  row: SessionRow,
  transcript: Transcript,
  memory: string,
): Promise<Transcript> {
  const next: Transcript = { ...transcript, memory };
  await saveTranscript(store, row, next);
  return next;
}

/** Append messages and persist in one step. Returns the updated transcript. */
export async function appendMessages(
  store: SessionStore,
  row: SessionRow,
  transcript: Transcript,
  ...messages: Anthropic.Beta.BetaMessageParam[]
): Promise<Transcript> {
  const next = withMessages(transcript, ...messages);
  await saveTranscript(store, row, next);
  return next;
}

/**
 * End a session permanently.
 *
 * Order matters and is not an implementation detail:
 *   1. mark 'closing'  — the session stops accepting turns
 *   2. zero the wrapped key — the payload becomes undecryptable RIGHT HERE.
 *      Everything after this point is bookkeeping.
 *   3. mark 'closed'
 *   4. delete the row
 *
 * If the process dies between 2 and 4, the leftover row is already unreadable.
 * There is no ordering of these steps that leaves a readable orphan.
 *
 * Phase 1 has no caller for this in the UI — by design, since the closing
 * ritual that decides what to keep is Phase 2. It exists so the erasure it
 * performs can be proved by test now, before anything depends on it.
 */
export async function destroySession(
  store: SessionStore,
  sessionId: string,
  userId: string,
): Promise<void> {
  const row = await store.find(sessionId, userId);
  if (!row) return;

  await store.setStatus(sessionId, userId, "closing");
  await store.overwriteWrappedKey(sessionId, userId, destroyedKeyBytes(row.wrappedKey.length));
  await store.setStatus(sessionId, userId, "closed");
  await store.remove(sessionId, userId);
}
