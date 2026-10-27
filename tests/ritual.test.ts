import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { appendMessages, resumeOrStartSession } from "@/lib/echo/sessions";
import { InMemorySessionStore } from "@/lib/echo/store";
import { commitClosing, proposeClosing, abandonClosing, RitualError } from "@/lib/echo/ritual";
import { buildMapPage, keepOnly, parseDistillation, type Distillation } from "@/lib/echo/schema";
import { FakeXTiles } from "@/lib/xtiles/fake";
import { XTilesWriteError } from "@/lib/xtiles/adapter";

/**
 * The closing ritual, with the recovery path as the centrepiece.
 *
 * "If the xTiles write fails, the session must NOT be destroyed." That sentence
 * is the reason this file exists — everything else here is supporting cast.
 */

const USER = "22222222-2222-4222-8222-222222222222";
const SECRET = "I have not told anyone that I already handed in my notice";

const DISTILLED: Distillation = {
  entry: {
    title: "Already Gone",
    theme: "The decision was made before you told anyone.",
    moment: "",
    leftOff: "Telling the people it affects.",
    pattern: "",
    sentence: "",
    light: "Deciding was the hard part, and it is behind you.",
    thread: "",
  },
};

vi.mock("@/lib/echo/distill", () => ({
  distill: vi.fn(async () => ({
    distillation: DISTILLED,
    metrics: {
      durationMs: 5,
      model: "claude-haiku-4-5",
      stopReason: "end_turn",
      errorClass: null,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
    },
  })),
  DistillationFailedError: class extends Error {},
}));

vi.mock("@/lib/echo/receipts", () => ({
  createReceipt: vi.fn(async () => {}),
  markWritten: vi.fn(async () => {}),
  markFailed: vi.fn(async () => {}),
}));

vi.mock("@/lib/echo/telemetry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/echo/telemetry")>();
  return { ...actual, recordTurn: vi.fn(async () => {}) };
});

beforeEach(() => {
  process.env.SESSION_MASTER_KEY = randomBytes(32).toString("base64");
});

async function conversation(store: InMemorySessionStore) {
  const opened = await resumeOrStartSession(store, USER);
  await appendMessages(store, opened.row, opened.transcript, { role: "user", content: SECRET });
  return opened.row.id;
}

describe("proposing", () => {
  it("marks the session closing so no more turns can land", async () => {
    const store = new InMemorySessionStore();
    const id = await conversation(store);

    await proposeClosing(store, USER);

    expect(store.peek(id)?.status).toBe("closing");
    expect(await store.findOpen(USER)).toBeNull();
  });

  it("resumes a ritual already under way rather than starting a second", async () => {
    const store = new InMemorySessionStore();
    const id = await conversation(store);

    const first = await proposeClosing(store, USER);
    const second = await proposeClosing(store, USER);

    expect(first.sessionId).toBe(id);
    expect(second.sessionId).toBe(id);
  });

  it("refuses when there is nothing open", async () => {
    const store = new InMemorySessionStore();
    await expect(proposeClosing(store, USER)).rejects.toThrow(RitualError);
  });
});

describe("changing your mind", () => {
  it("puts the conversation back, intact", async () => {
    const store = new InMemorySessionStore();
    const id = await conversation(store);

    await proposeClosing(store, USER);
    await abandonClosing(store, USER);

    expect(store.peek(id)?.status).toBe("open");
    expect((await store.findOpen(USER))?.id).toBe(id);
  });
});

describe("when the xTiles write fails", () => {
  it("does NOT destroy the session — this is the whole recovery path", async () => {
    const store = new InMemorySessionStore();
    const xtiles = new FakeXTiles();
    const id = await conversation(store);
    const proposal = await proposeClosing(store, USER);

    xtiles.failNextWrite = { reason: "upstream 503", retryable: true };

    await expect(
      commitClosing(store, xtiles, USER, id, ["entry-theme"], proposal.distillation),
    ).rejects.toThrow(RitualError);

    // Every byte is still here.
    const row = store.peek(id);
    expect(row).toBeDefined();
    expect(row!.wrappedKey.some((byte) => byte !== 0)).toBe(true);
    expect(await store.find(id, USER)).not.toBeNull();
  });

  it("tells the person their conversation is safe, not that something broke", async () => {
    const store = new InMemorySessionStore();
    const xtiles = new FakeXTiles();
    const id = await conversation(store);
    const proposal = await proposeClosing(store, USER);

    xtiles.failNextWrite = { reason: "upstream 503", retryable: true };

    const error = await commitClosing(
      store,
      xtiles,
      USER,
      id,
      ["entry-theme"],
      proposal.distillation,
    ).catch((e: RitualError) => e);

    expect(error).toBeInstanceOf(RitualError);
    expect((error as RitualError).message).toMatch(/haven't ended the conversation/i);
    expect((error as RitualError).retryable).toBe(true);
  });

  it("says the hub is missing, and that it can be set up, when there is none to write to", async () => {
    const store = new InMemorySessionStore();
    const xtiles = new FakeXTiles();
    const id = await conversation(store);
    const proposal = await proposeClosing(store, USER);

    xtiles.failNextWrite = { reason: "no EchoHub project", retryable: false, hubMissing: true };

    const error = (await commitClosing(store, xtiles, USER, id, ["entry-theme"], proposal.distillation).catch(
      (e: RitualError) => e,
    )) as RitualError;

    expect(error.kind).toBe("hub-missing");
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/set it up below/i);
    // And nothing was lost: the conversation is still there.
    expect(await store.find(id, USER)).not.toBeNull();
  });

  it("offers a fresh hub, and a retry, when xTiles refuses the entry", async () => {
    const store = new InMemorySessionStore();
    const xtiles = new FakeXTiles();
    const id = await conversation(store);
    const proposal = await proposeClosing(store, USER);

    xtiles.failNextWrite = { reason: "tool: refused", retryable: true, hubRejected: true };

    const error = (await commitClosing(store, xtiles, USER, id, ["entry-theme"], proposal.distillation).catch(
      (e: RitualError) => e,
    )) as RitualError;

    expect(error.kind).toBe("hub-unusable");
    expect(error.retryable).toBe(true);
    expect(error.message).toMatch(/set up a fresh one/i);
    expect(await store.find(id, USER)).not.toBeNull();
  });

  it("succeeds on retry, and writes exactly once", async () => {
    const store = new InMemorySessionStore();
    const xtiles = new FakeXTiles();
    const id = await conversation(store);
    const proposal = await proposeClosing(store, USER);

    xtiles.failNextWrite = { reason: "upstream 503", retryable: true };
    await commitClosing(store, xtiles, USER, id, ["entry-theme"], proposal.distillation).catch(
      () => {},
    );

    // The retry goes through.
    await commitClosing(store, xtiles, USER, id, ["entry-theme"], proposal.distillation);

    expect(store.peek(id)).toBeUndefined();
    const workspace = await xtiles.readExisting(USER);
    expect(workspace).toHaveLength(1);
  });

  it("does not destroy the session when xTiles is not connected", async () => {
    const store = new InMemorySessionStore();
    const notConnected = new FakeXTiles();
    vi.spyOn(notConnected, "isConnected").mockResolvedValue(false);

    const id = await conversation(store);
    const proposal = await proposeClosing(store, USER);

    await expect(
      commitClosing(store, notConnected, USER, id, ["entry-theme"], proposal.distillation),
    ).rejects.toThrow(/isn't connected/i);

    expect(store.peek(id)).toBeDefined();
  });
});

describe("idempotency", () => {
  it("a repeated write under one key does not duplicate an entry on the Map", async () => {
    const xtiles = new FakeXTiles();
    const page = buildMapPage(DISTILLED.entry!, "September 26, 2026");
    const first = await xtiles.write(USER, page, "key-1");
    const second = await xtiles.write(USER, page, "key-1");

    expect(second.ref).toBe(first.ref);
    expect(await xtiles.readExisting(USER)).toHaveLength(1);
  });
});

describe("the schema seam", () => {
  it("keeps exactly the fields chosen, by stable id", () => {
    const kept = keepOnly(DISTILLED, ["entry-light"]);
    expect(kept.entry?.light).toBe(DISTILLED.entry!.light);
    expect(kept.entry?.theme).toBe("");
    expect(kept.entry?.leftOff).toBe("");
    // The title always comes with whatever is kept.
    expect(kept.entry?.title).toBe("Already Gone");
  });

  it("keeping no fields means no entry at all", () => {
    expect(keepOnly(DISTILLED, []).entry).toBeNull();
  });

  it("rejects a distillation with the wrong shape rather than storing it", () => {
    expect(() => parseDistillation("a paragraph of prose")).toThrow(/not an object/);
    expect(() => parseDistillation({})).toThrow(/no entry/);
    expect(() => parseDistillation({ entry: { title: "x" } })).toThrow(/theme is missing/);
  });

  it("never quotes the offending value in the error, since it came from a conversation", () => {
    const error = (() => {
      try {
        parseDistillation({
          entry: { ...DISTILLED.entry, title: "Fine", theme: "", light: "SECRET TEXT" },
        });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain("SECRET TEXT");
  });
});

describe("XTilesWriteError", () => {
  it("carries whether retrying is worth it", () => {
    expect(new XTilesWriteError("401", false).retryable).toBe(false);
    expect(new XTilesWriteError("503", true).retryable).toBe(true);
  });
});
