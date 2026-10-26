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
  discardStranded,
  findStranded,
  readTranscript,
  reopenStranded,
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
  /** A conversation with something in it, stranded mid-closing. */
  async function stranded(store: InMemorySessionStore, words = CONFESSION) {
    const session = await resumeOrStartSession(store, USER);
    await appendMessages(store, session.row, session.transcript, { role: "user", content: words });
    await store.setStatus(session.row.id, USER, "closing");
    return session.row.id;
  }

  it("is noticed, so the chat can ask instead of guessing", async () => {
    const store = new InMemorySessionStore();
    const id = await stranded(store);
    expect((await findStranded(store, USER))?.id).toBe(id);
  });

  it("is not stranded when there is an open conversation beside it", async () => {
    const store = new InMemorySessionStore();
    await stranded(store);
    await resumeOrStartSession(store, USER); // a new open one
    expect(await findStranded(store, USER)).toBeNull();
  });

  it("is picked up where it stopped, with every word still there", async () => {
    const store = new InMemorySessionStore();
    const id = await stranded(store);

    expect(await reopenStranded(store, USER)).toBe(true);
    const again = await resumeOrStartSession(store, USER);
    expect(again.row.id).toBe(id);
    expect(again.row.status).toBe("open");
    expect(JSON.stringify(again.transcript)).toContain(CONFESSION);
  });

  it("picks up the most recent when there are several", async () => {
    const store = new InMemorySessionStore();
    await stranded(store, "an older conversation");
    const newer = await stranded(store, "a newer conversation");
    await reopenStranded(store, USER);
    expect(store.peek(newer)?.status).toBe("open");
  });

  it("is destroyed for good when they start fresh, every leftover with it", async () => {
    const store = new InMemorySessionStore();
    const a = await stranded(store, "first leftover");
    const b = await stranded(store, "second leftover");

    expect(await discardStranded(store, USER)).toBe(2);
    expect(store.peek(a)).toBeUndefined();
    expect(store.peek(b)).toBeUndefined();
    expect(await findStranded(store, USER)).toBeNull();

    // And what follows is a genuinely fresh, empty conversation.
    const fresh = await resumeOrStartSession(store, USER);
    expect(fresh.transcript.messages).toHaveLength(0);
  });

  it("leaves other people's conversations alone", async () => {
    const store = new InMemorySessionStore();
    await stranded(store);
    expect(await findStranded(store, OTHER_USER)).toBeNull();
    expect(await discardStranded(store, OTHER_USER)).toBe(0);
    expect(await findStranded(store, USER)).not.toBeNull();
  });

  it("resuming does not quietly reopen it", async () => {
    const store = new InMemorySessionStore();
    const id = await stranded(store);
    // resumeOrStartSession only ever joins an OPEN conversation: the chat page asks first.
    const fresh = await resumeOrStartSession(store, USER);
    expect(fresh.row.id).not.toBe(id);
    expect(store.peek(id)?.status).toBe("closing");
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
