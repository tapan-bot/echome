import { MY_REFLECTION, formatEntryDate, type JsonSchema, type MapPage } from "@/lib/echo/schema";

/**
 * Turn the Page ("Echo turn"): looking back over a stretch of the EchoMap, keeping a short
 * page that can stand on its own, and carrying on in a fresh EchoHub.
 *
 * The ritual is Todd's (EchoMe skill v3.11, Section 11). What this app adds is the trigger:
 * once the EchoMap holds enough conversations the person is OFFERED the page, never made to
 * turn it. Their old EchoHub is never changed or deleted; a new one is made beside it, begins
 * with the Turn the Page tile, and is the one conversations are saved to from then on.
 *
 * Everything here is pure text in, text out. The summary is made from the EchoMap entries
 * (the person's own distilled record), never from a conversation.
 */

/**
 * How many conversations an EchoMap holds before the page can be turned.
 * 5 while this is being tested; the plan is 25.
 */
export const PAGE_TURN_AFTER = 5;

/** The heading every Turn the Page tile starts with. */
export const TURN_TILE_TITLE = "Turn the Page";

/** An EchoMap heading that is a saved conversation: not the Purpose tile, not a Turn the Page tile. */
export function isConversationEntry(heading: string): boolean {
  const key = heading.trim().toLowerCase();
  return key.length > 0 && key !== "purpose" && !key.startsWith(TURN_TILE_TITLE.toLowerCase());
}

function isTurnTile(heading: string): boolean {
  return heading.trim().toLowerCase().startsWith(TURN_TILE_TITLE.toLowerCase());
}

/** Saved conversations in this EchoMap. */
export function countConversations(entries: readonly MapPage[]): number {
  return entries.filter((entry) => isConversationEntry(entry.heading)).length;
}

/** The pages already turned that this EchoMap remembers (the Turn the Page tiles it holds). */
export function countTurns(entries: readonly MapPage[]): number {
  return entries.filter((entry) => isTurnTile(entry.heading)).length;
}

export function isTurnDue(conversations: number): boolean {
  return conversations >= PAGE_TURN_AFTER;
}

/** The new EchoHub's name. Distinct from "EchoHub", so it is never mistaken for the first. */
export function pageProjectTitle(turnsSoFar: number): string {
  return `EchoHub — Page ${turnsSoFar + 2}`;
}

// ---------------------------------------------------------------------------
// The tile
// ---------------------------------------------------------------------------

/** What the Turn the Page tile holds, in Todd's order. */
export interface TurnSummary {
  /** Theme of the season. */
  readonly theme: string;
  /** The trail, in brief: one dated line per entry. */
  readonly trail: readonly string[];
  /** What moved. */
  readonly moved: string;
  /** What's still carried. */
  readonly carried: string;
  /** Words worth keeping: their own sentences, from the entries. */
  readonly words: readonly string[];
  /** A light for the next stretch. */
  readonly light: string;
  /** The seasonal Echo Thread: how to accompany them into the next stretch. Often empty. */
  readonly thread: string;
}

export const TURN_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    theme: { type: "string", description: "Theme of the season: what this stretch was really about. One to three sentences." },
    trail: {
      type: "array",
      items: { type: "string" },
      description:
        "The trail, in brief: exactly one line per entry, oldest first, each starting with that entry's date as written, then its essence in the person's own language.",
    },
    moved: { type: "string", description: "What moved between the first entry and the last. Point at movement; never grade it." },
    carried: { type: "string", description: "What is still being carried. Empty string if nothing clearly is." },
    words: {
      type: "array",
      items: { type: "string" },
      description: "Words worth keeping: up to five of the person's OWN sentences, copied exactly from the entries. Never invented.",
    },
    light: { type: "string", description: "A light for the next stretch: one short line earned by this season." },
    thread: {
      type: "string",
      description: "The seasonal Echo Thread: one to three sentences on how to accompany this person next. Empty string if nothing was learned.",
    },
  },
  required: ["theme", "trail", "moved", "carried", "words", "light", "thread"],
  additionalProperties: false,
};

export class TurnShapeError extends Error {
  override readonly name = "TurnShapeError";
}

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();
const compare = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const MAX_LINE = 600;
const MAX_TRAIL = 120;
const MAX_WORDS = 5;

/**
 * Validate what the model returned. Errors describe the shape that was wrong and never quote a
 * value. "Words worth keeping" must be the person's own words, so any line that does not appear
 * in `source` (the entries it was made from) is dropped rather than trusted.
 */
export function parseTurnSummary(value: unknown, source: string): TurnSummary {
  if (typeof value !== "object" || value === null) throw new TurnShapeError("Summary is not an object.");
  const raw = value as Record<string, unknown>;

  const text = (key: string, required: boolean): string => {
    const field = raw[key];
    if (typeof field !== "string") throw new TurnShapeError(`Summary field "${key}" is not text.`);
    const clean = oneLine(field).slice(0, MAX_LINE);
    if (required && clean.length === 0) throw new TurnShapeError(`Summary field "${key}" is empty.`);
    return clean;
  };
  const list = (key: string): string[] => {
    const field = raw[key];
    if (!Array.isArray(field) || field.some((item) => typeof item !== "string")) {
      throw new TurnShapeError(`Summary field "${key}" is not a list of text.`);
    }
    return (field as string[]).map(oneLine).filter((line) => line.length > 0);
  };

  const haystack = compare(source);
  const words = list("words")
    .map((line) => line.replace(/^["“”']+|["“”']+$/g, ""))
    .filter((line) => line.length > 0 && haystack.includes(compare(line)))
    .slice(0, MAX_WORDS);

  const trail = list("trail").slice(0, MAX_TRAIL).map((line) => line.slice(0, MAX_LINE));
  if (trail.length === 0) throw new TurnShapeError("Summary has no trail.");

  return {
    theme: text("theme", true),
    trail,
    moved: text("moved", false),
    carried: text("carried", false),
    words,
    light: text("light", true),
    thread: text("thread", false),
  };
}

/** The tile, in Todd's order, ready for the EchoMap. Dated with the person's own day. */
export function buildTurnPage(summary: TurnSummary, now: Date, timeZone?: string): MapPage {
  const heading = `${TURN_TILE_TITLE} — ${formatEntryDate(now, timeZone)}`;
  const field = (label: string, text: string): string | null => (text.length > 0 ? `**${label}:** ${text}` : null);
  const bullets = (label: string, lines: readonly string[]): string | null =>
    lines.length > 0 ? [`**${label}:**`, ...lines.map((line) => `- ${line}`)].join("\n") : null;

  const parts = [
    `### ${heading}`,
    field("Theme of the season", summary.theme),
    bullets("The trail, in brief", summary.trail),
    field("What moved", summary.moved),
    field("What's still carried", summary.carried),
    bullets("Words worth keeping", summary.words.map((line) => `“${line}”`)),
    field("A light for the next stretch", summary.light),
    MY_REFLECTION,
    field("Echo Thread", summary.thread),
  ].filter((part): part is string => part !== null);

  return { heading, markdown: parts.join("\n\n") };
}

/** The entries as one piece of text, for the summary to read. */
export function entriesAsText(entries: readonly MapPage[]): string {
  return entries
    .filter((entry) => isConversationEntry(entry.heading))
    .map((entry) => entry.markdown)
    .join("\n\n");
}
