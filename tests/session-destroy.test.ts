import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DecryptionError,
  decryptTranscript,
  isDestroyedKey,
  sessionAad,
  SessionKeyDestroyedError,
  unwrapSessionKey,
} from "@/lib/echo/crypto";
import {
  appendMessages,
  destroySession,
  readTranscript,
  resumeOrStartSession,
} from "@/lib/echo/sessions";
import {
  InMemorySessionStore,
  type NewSession,
  type PayloadUpdate,
  type SessionRow,
  type SessionStatus,
  type SessionStore,
} from "@/lib/echo/store";

const USER = "22222222-2222-4222-8222-222222222222";
const OTHER_USER = "99999999-9999-4999-8999-999999999999";

/** A phrase we can grep the database bytes for. */
const CONFESSION = "the thing I have never told anyone is that I am afraid of being ordinary";

beforeEach(() => {
  process.env.SESSION_MASTER_KEY = randomBytes(32).toString("base64");
});

/** Wraps a store and records the order of writes, so we can assert on it. */
class RecordingStore implements SessionStore {
  readonly ops: string[] = [];
  /** The row as it stood immediately before each operation was applied. */
  readonly snapshots: Array<{ op: string; row: SessionRow | undefined }> = [];

  constructor(private readonly inner: InMemorySessionStore) {}

  private record(op: string, sessionId: string) {
    this.ops.push(op);
    const row = this.inner.peek(sessionId);
    this.snapshots.push({ op, row: row ? { ...row } : undefined });
  }

  findOpen(userId: string) {
    return this.inner.findOpen(userId);
  }
  findClosing(userId: string) {
    return this.inner.findClosing(userId);
  }
  find(sessionId: string, userId: string) {
    return this.inner.find(sessionId, userId);
  }
  create(session: NewSession) {
    return this.inner.create(session);
  }
  savePayload(sessionId: string, userId: string, update: PayloadUpdate) {
    return this.inner.savePayload(sessionId, userId, update);
  }
  async setStatus(sessionId: string, userId: string, status: SessionStatus) {
    await this.inner.setStatus(sessionId, userId, status);
    this.record(`status:${status}`, sessionId);
  }
  async overwriteWrappedKey(sessionId: string, userId: string, bytes: Buffer) {
    await this.inner.overwriteWrappedKey(sessionId, userId, bytes);
    this.record("zero-key", sessionId);
  }
  async remove(sessionId: string, userId: string) {
    this.record("delete", sessionId);
    await this.inner.remove(sessionId, userId);
  }
}

async function seededSession(store: SessionStore) {
  const opened = await resumeOrStartSession(store, USER);
  await appendMessages(
    store,
    opened.row,
    opened.transcript,
    { role: "user", content: CONFESSION },
    { role: "assistant", content: "What would ordinary have to mean, for that to be the fear?" },
  );
  const row = await store.find(opened.row.id, USER);
  if (!row) throw new Error("session vanished during setup");
  return row;
}

describe("a conversation left part-way through closing", () => {
  it("is resumed, not skipped for a new empty one", async () => {
    const store = new InMemorySessionStore();
    const first = await resumeOrStartSession(store, USER);
    await appendMessages(store, first.row, first.transcript, { role: "user", content: CONFESSION });

    // They reached the closing screen, then pressed "Go back".
    await store.setStatus(first.row.id, USER, "closing");

    const again = await resumeOrStartSession(store, USER);
    expect(again.row.id).toBe(first.row.id);
    expect(again.row.status).toBe("open");
    expect(store.peek(first.row.id)?.status).toBe("open");
    expect(JSON.stringify(again.transcript)).toContain(CONFESSION);
  });
});

describe("a live session", () => {
  it("round-trips a conversation through the store", async () => {
    const store = new InMemorySessionStore();
    const row = await seededSession(store);
    const transcript = readTranscript(row);
    expect(transcript.messages).toHaveLength(2);
    expect(transcript.messages[0]!.content).toBe(CONFESSION);
  });

  it("stores nothing readable in the payload", async () => {
    const store = new InMemorySessionStore();
    const row = await seededSession(store);
    for (const encoding of ["utf8", "latin1", "ascii"] as const) {
      expect(row.encryptedPayload.toString(encoding)).not.toContain("ordinary");
      expect(row.encryptedPayload.toString(encoding)).not.toContain("afraid");
    }
    expect(row.encryptedPayload.toString("hex")).not.toContain(
      Buffer.from(CONFESSION, "utf8").toString("hex"),
    );
  });

  it("resumes rather than starting a second session for the same user", async () => {
    const store = new InMemorySessionStore();
    const first = await seededSession(store);
    const second = await resumeOrStartSession(store, USER);
    expect(second.row.id).toBe(first.id);
    expect(second.transcript.messages).toHaveLength(2);
  });

  it("survives a process restart, because nothing is held in memory", async () => {
    const store = new InMemorySessionStore();
    const row = await seededSession(store);

    // Simulate the server going away and coming back: keep only the bytes a
    // database would have persisted, and rebuild the row from those alone.
    const persisted = {
      id: row.id,
      userId: row.userId,
      status: row.status,
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
      encryptedPayload: Buffer.from(row.encryptedPayload.toString("hex"), "hex"),
      wrappedKey: Buffer.from(row.wrappedKey.toString("hex"), "hex"),
      nonce: Buffer.from(row.nonce.toString("hex"), "hex"),
    } satisfies SessionRow;

    expect(readTranscript(persisted).messages[0]!.content).toBe(CONFESSION);
  });

  it("cannot be read by another user, even with the row in hand", async () => {
    const store = new InMemorySessionStore();
    const row = await seededSession(store);
    const sessionKey = unwrapSessionKey(row.wrappedKey);
    expect(() =>
      decryptTranscript(row.encryptedPayload, row.nonce, sessionKey, sessionAad(row.id, OTHER_USER)),
    ).toThrow(DecryptionError);
  });
});

describe("destroySession", () => {
  it("zeroes the key before deleting the row, never the other way round", async () => {
    const inner = new InMemorySessionStore();
    const store = new RecordingStore(inner);
    const row = await seededSession(store);

    await destroySession(store, row.id, USER);

    expect(store.ops).toEqual(["status:closing", "zero-key", "status:closed", "delete"]);

    // At the instant of deletion the key was already destroyed, so a crash
    // anywhere after step 2 still leaves an unreadable row.
    const atDelete = store.snapshots.find((s) => s.op === "delete");
    expect(atDelete?.row).toBeDefined();
    expect(isDestroyedKey(atDelete!.row!.wrappedKey)).toBe(true);
  });

  it("leaves no row behind", async () => {
    const store = new InMemorySessionStore();
    const row = await seededSession(store);
    await destroySession(store, row.id, USER);

    expect(store.peek(row.id)).toBeUndefined();
    expect(await store.find(row.id, USER)).toBeNull();
    expect(await store.findOpen(USER)).toBeNull();
  });

  it("makes the payload permanently undecryptable, even to us", async () => {
    const inner = new InMemorySessionStore();
    const store = new RecordingStore(inner);
    const row = await seededSession(store);

    // Stand in an attacker's shoes: they took a database backup a moment before
    // the close, so they hold the ciphertext, the nonce and the row identifiers.
    // What they do NOT have is the wrapped key after it was zeroed.
    const stolenPayload = Buffer.from(row.encryptedPayload);
    const stolenNonce = Buffer.from(row.nonce);
    const masterKeyWeStillHave = process.env.SESSION_MASTER_KEY;

    await destroySession(store, row.id, USER);

    const zeroedKey = store.snapshots.find((s) => s.op === "delete")!.row!.wrappedKey;

    // We are the operator. We hold the master key. We still cannot get in.
    expect(process.env.SESSION_MASTER_KEY).toBe(masterKeyWeStillHave);
    expect(() => unwrapSessionKey(zeroedKey)).toThrow(SessionKeyDestroyedError);

    // And there is no other route to the session key: it was random, it was
    // never written anywhere but inside the wrapped blob that is now zeroes.
    // Any guess at it fails the GCM tag.
    for (let attempt = 0; attempt < 32; attempt += 1) {
      expect(() =>
        decryptTranscript(stolenPayload, stolenNonce, randomBytes(32), sessionAad(row.id, USER)),
      ).toThrow(DecryptionError);
    }

    // The stolen bytes were never readable in the first place.
    expect(stolenPayload.toString("latin1")).not.toContain("ordinary");
  });

  it("is a no-op on someone else's session", async () => {
    const store = new InMemorySessionStore();
    const row = await seededSession(store);
    await destroySession(store, row.id, OTHER_USER);
    expect(store.peek(row.id)).toBeDefined();
    expect(readTranscript((await store.find(row.id, USER))!).messages).toHaveLength(2);
  });
});
