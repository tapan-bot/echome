import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * tidy.ts against a mocked SDK. The promises worth proving: the request is the
 * shape the 2026 API wants, only the most recent context is sent, and every way
 * the tidy-up can go wrong (a refusal, an answer instead of a correction, an
 * outage) leaves the person's spoken words exactly as they were.
 */

const mock = vi.hoisted(() => ({
  lastBody: null as Record<string, unknown> | null,
  calls: 0,
  response: null as unknown,
  throws: null as Error | null,
}));

vi.mock("@anthropic-ai/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@anthropic-ai/sdk")>();
  class MockAnthropic {
    beta = {
      messages: {
        async create(body: Record<string, unknown>) {
          mock.calls += 1;
          mock.lastBody = body;
          if (mock.throws) throw mock.throws;
          return mock.response;
        },
      },
    };
  }
  return { ...actual, default: MockAnthropic };
});

process.env.ANTHROPIC_API_KEY = "test-key";
const { tidyDictation, MAX_CONTEXT_CHARS } = await import("@/lib/echo/tidy");

const reply = (text: string, stop_reason = "end_turn") => ({
  stop_reason,
  content: [{ type: "text", text }],
});

const SPOKEN = "i went to see there mother yesterday and she was not well";

beforeEach(() => {
  mock.lastBody = null;
  mock.calls = 0;
  mock.throws = null;
  mock.response = reply("I went to see their mother yesterday, and she was not well.");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("tidying dictated words", () => {
  it("returns the same words, corrected", async () => {
    const result = await tidyDictation("I was thinking about", SPOKEN);
    expect(result).toEqual({ text: "I went to see their mother yesterday, and she was not well.", changed: true });
  });

  it("shapes the request the way the 2026 API requires", async () => {
    await tidyDictation("earlier words", SPOKEN);
    const body = mock.lastBody!;
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.max_tokens).toBe(1024);
    for (const removed of ["temperature", "top_p", "top_k", "budget_tokens", "thinking"]) {
      expect(body).not.toHaveProperty(removed);
    }
    expect(body.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(body.fallbacks).toBe("default");
    // No assistant prefill: the last message is the person's, as data in tags.
    const messages = body.messages as { role: string; content: string }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toContain("<before>earlier words</before>");
    expect(messages[0]!.content).toContain(`<dictated>${SPOKEN}</dictated>`);
  });

  it("sends only the most recent part of what was already written", async () => {
    const long = `${"x".repeat(5000)}END`;
    await tidyDictation(long, SPOKEN);
    const content = (mock.lastBody!.messages as { content: string }[])[0]!.content;
    expect(content).toContain("END</before>");
    expect(content.length).toBeLessThan(MAX_CONTEXT_CHARS + SPOKEN.length + 200);
  });

  it("says nothing changed when the words were already fine", async () => {
    mock.response = reply(SPOKEN);
    expect(await tidyDictation("", SPOKEN)).toEqual({ text: SPOKEN, changed: false });
  });

  it("strips quotation marks the model wrapped around its answer", async () => {
    mock.response = reply('"I went to see their mother yesterday and she was not well."');
    expect((await tidyDictation("", SPOKEN)).text).toBe("I went to see their mother yesterday and she was not well.");
  });

  it("keeps the spoken words when the model answers instead of correcting", async () => {
    mock.response = reply("I'm sorry to hear that. Would you like to talk about her health?");
    expect(await tidyDictation("", SPOKEN)).toEqual({ text: SPOKEN, changed: false });
  });

  it("keeps the spoken words on a refusal", async () => {
    mock.response = { stop_reason: "refusal", content: [] };
    expect(await tidyDictation("", SPOKEN)).toEqual({ text: SPOKEN, changed: false });
  });

  it("keeps the spoken words, and does not throw, when the API is down", async () => {
    mock.throws = new Error("network down");
    expect(await tidyDictation("", SPOKEN)).toEqual({ text: SPOKEN, changed: false });
  });

  it("never logs what the person said", async () => {
    mock.throws = new Error(`failed on: ${SPOKEN}`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await tidyDictation("private context", SPOKEN);
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).not.toContain("mother");
    expect(logged).not.toContain("private context");
  });

  it("does not call the API for nothing", async () => {
    expect(await tidyDictation("context", "   ")).toEqual({ text: "", changed: false });
    expect(mock.calls).toBe(0);
  });
});
