import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { classifyError } from "@/lib/echo/telemetry";
import { TURN_SCHEMA, parseTurnSummary, type TurnSummary } from "@/lib/echo/turn";

/**
 * Looking back over a season of the EchoMap: the entries in, one Turn the Page summary out.
 *
 * Made from the EchoMap entries the person already keeps in their own xTiles (their distilled
 * record), never from a conversation. The entries are used for one request and are not stored,
 * logged or reported anywhere from here. Errors carry a class only.
 *
 * The voice and the rules are Todd's (EchoMe skill v3.11, Section 11): point at movement, do not
 * grade it; no scores, no clinical words; their own language; accompaniment, never analysis.
 */

export const TURN_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 4000;

const INSTRUCTIONS = `You read a stretch of someone's EchoMap (the dated entries of their past reflective conversations, oldest first) and write the one "Turn the Page" page that gathers it. It must be able to stand alone: they may later let the old entries go, so the page carries enough of the trail to survive without them. Write in EchoMe's voice: warm, plain, unhurried, never clinical.

You are not grading and not analysing. You are helping them read their own trail. Point at movement; never measure it. No scores, no progress percentages, no "you have improved at".

Return every field.

- theme: what this stretch was really about, in their language. One to three sentences.
- trail: exactly one line per entry, oldest first. Each line starts with that entry's date as written in its heading, then a dash, then the essence of that entry in the person's own language. Short.
- moved: what changed between the first entry and the last. What got lighter, what shifted. Only what the entries show.
- carried: what is still being carried. Use an empty string if nothing clearly is.
- words: up to five sentences the person said or kept, copied EXACTLY, word for word, from the entries. Never invent or reword one. Use an empty list if there are none.
- light: one short line of encouragement earned by this stretch. Never generic.
- thread: the seasonal Echo Thread: one to three sentences from EchoMe to EchoMe on how to accompany this person into the next stretch: their pace, how they like to be spoken with, what gentleness the season taught. Accompaniment, never analysis. Remember the relationship, not a diagnosis. Use an empty string if nothing was learned.

Never include: anything the person asked to keep off the record; anything about self-harm or crisis (leave it out entirely and do not respond to it); raw pain repeated in their words; names, places, employers or other identifying detail.

Write theme, moved, carried and light to the person, as "you". Write thread about them as "they". Never guess or use gender: no he, she, him, her, and no "as a son" or "as a mother". No clinical or evaluative language, ever.`;

export class SummaryFailedError extends Error {
  override readonly name = "SummaryFailedError";
  constructor(readonly reason: string) {
    super(`Summary failed: ${reason}`);
  }
}

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    client = new Anthropic({ apiKey });
  }
  return client;
}

/** Roughly how much of the trail is read: the newest entries are kept if it is very long. */
const MAX_INPUT_CHARS = 60_000;

export async function summariseSeason(entriesText: string): Promise<TurnSummary> {
  const source = entriesText.length > MAX_INPUT_CHARS ? entriesText.slice(-MAX_INPUT_CHARS) : entriesText;
  try {
    const response = await anthropic().beta.messages.parse({
      model: TURN_MODEL,
      max_tokens: MAX_TOKENS,
      system: INSTRUCTIONS,
      messages: [{ role: "user", content: source }],
      output_config: { format: { type: "json_schema", schema: TURN_SCHEMA } },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    // Checked before content is read, as everywhere else in this codebase.
    if (response.stop_reason === "refusal") throw new SummaryFailedError("refusal");
    return parseTurnSummary(response.parsed_output, source);
  } catch (error) {
    if (error instanceof SummaryFailedError) throw error;
    // The class only: an upstream error body can echo the request, and the request is their trail.
    throw new SummaryFailedError(classifyError(error));
  }
}
