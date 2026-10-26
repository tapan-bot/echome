/**
 * The EchoMap entry.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Source: Todd Savard's EchoMe skill v3.11, Section 7 ("At session close — the
 *  EchoMap log"). That document is authoritative; this file is the one place
 *  its entry format lives, as typed definitions used for the distiller's
 *  structured-output format, for validation, for the closing ritual's choices,
 *  and for rendering the page written to xTiles. Changing the spec means
 *  editing this file.
 *
 *  What the skill says, and what follows from it:
 *
 *  - The EchoMap is the trail: ONE dated entry per session. Its fields, each
 *    answering a human question: Theme, Moment that mattered, Where we left
 *    off, Pattern noticed, A sentence worth keeping, A light to leave on
 *    (always last of those), then the fixed "My Reflection" placeholder, then an
 *    optional Echo Thread.
 *  - The entry scales with the session: a brief one earns a Theme and a Light,
 *    nothing more. So only Theme and Light are required; the rest may be empty.
 *  - The EchoCompass is "read always, written never" by EchoMe: it is the
 *    person's own introduction, in their own words. This app therefore never
 *    distils or writes a Compass. There is no Compass type here on purpose.
 *  - Every entry is headed "### Month Day, Year — Short Title". The date is the
 *    session's real date, supplied by the app — never the model's guess.
 *  - "My Reflection" is theirs alone. The app writes the placeholder line and
 *    never any text in it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A JSON Schema fragment, as Claude's output_config.format expects. */
export interface JsonSchema {
  // The SDK types the schema as an open record, so this must admit unknown keys.
  readonly [key: string]: unknown;
  readonly type: string;
  readonly properties?: Record<string, unknown>;
  readonly items?: unknown;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly maxItems?: number;
}

// ---------------------------------------------------------------------------
// The fields, in the order they appear on the page.
// ---------------------------------------------------------------------------

export const ENTRY_FIELDS = [
  {
    key: "theme",
    label: "Theme",
    required: true,
    guide: "What was this really about? A sentence or two.",
  },
  {
    key: "moment",
    label: "Moment that mattered",
    required: false,
    guide:
      "What changed? A realization, a decision, a hard thing said out loud. Only if one truly happened.",
  },
  {
    key: "leftOff",
    label: "Where we left off",
    required: false,
    guide: "What still matters — what felt unfinished or worth returning to.",
  },
  {
    key: "pattern",
    label: "Pattern noticed",
    required: false,
    guide:
      "Only if the same thread surfaced at least three separate times in this conversation. " +
      "Notice, never guess. Almost always empty.",
  },
  {
    key: "sentence",
    label: "A sentence worth keeping",
    required: false,
    guide:
      "One sentence, usually the person's own, that captures something worth finding again in " +
      "six months. Optional.",
  },
  {
    key: "light",
    label: "A light to leave on",
    required: true,
    guide:
      "One short line of encouragement earned by this conversation: a quote that fits the moment, " +
      "or a sentence written from it. Never generic — it should only make sense because of what " +
      "happened here. Warm.",
  },
  {
    key: "thread",
    label: "Echo Thread",
    required: false,
    guide:
      "A note from EchoMe to EchoMe about how to walk beside this person next time. " +
      "Accompaniment, never analysis. Rare — most sessions leave it empty.",
  },
] as const;

export type EntryFieldKey = (typeof ENTRY_FIELDS)[number]["key"];

/** Written by the app, on every entry, exactly. The person fills it in, never EchoMe. */
export const MY_REFLECTION = "**My Reflection:** *(yours to write, whenever you want)*";

/**
 * One EchoMap entry. Every field is a plain string; an empty string means the
 * session did not earn it. (An empty string rather than null keeps the
 * structured-output schema simple and lets every field share one shape.)
 */
export type MapEntry = { readonly title: string } & { readonly [K in EntryFieldKey]: string };

/**
 * What the distiller returns. `entry` is null only when there was nothing to
 * distil at all — no message was ever sent — or after the person has chosen to
 * keep none of it.
 */
export interface Distillation {
  readonly entry: MapEntry | null;
}

/** A finished page, ready for xTiles. */
export interface MapPage {
  /** "Month Day, Year — Short Title", without the markdown marker. */
  readonly heading: string;
  /** The whole entry as markdown, heading line included. */
  readonly markdown: string;
}

// ---------------------------------------------------------------------------
// The same shape, as the structured-output format Claude is given.
// ---------------------------------------------------------------------------

export const DISTILLATION_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    entry: {
      type: "object",
      description: "The one EchoMap entry for this conversation.",
      properties: {
        title: {
          type: "string",
          description:
            "A short, plain title of two to five words, e.g. 'Just Checking In'. No names, no date.",
        },
        ...Object.fromEntries(
          ENTRY_FIELDS.map((field) => [
            field.key,
            {
              type: "string",
              description: field.required
                ? field.guide
                : `${field.guide} Use an empty string if this conversation did not earn it.`,
            },
          ]),
        ),
      },
      required: ["title", ...ENTRY_FIELDS.map((field) => field.key)],
      additionalProperties: false,
    },
  },
  required: ["entry"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// Validation. The distiller returns JSON or it fails — never prose.
// ---------------------------------------------------------------------------

export class DistillationShapeError extends Error {
  override readonly name = "DistillationShapeError";
}

/** One line of text. A stray newline or heading marker must not restructure the page. */
function tidy(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Validate a parsed distillation. Errors describe the SHAPE that was wrong and
 * never quote the value, because the value is distilled from a conversation.
 */
export function parseDistillation(value: unknown): Distillation {
  if (typeof value !== "object" || value === null) {
    throw new DistillationShapeError("Distillation is not an object.");
  }
  const candidate = (value as { entry?: unknown }).entry;
  if (candidate === null) return { entry: null };
  if (typeof candidate !== "object" || candidate === undefined) {
    throw new DistillationShapeError("Distillation has no entry.");
  }

  const raw = candidate as Record<string, unknown>;

  if (typeof raw.title !== "string" || tidy(raw.title).length === 0) {
    throw new DistillationShapeError("Entry has no title.");
  }

  const entry: Record<string, string> = { title: tidy(raw.title) };
  for (const field of ENTRY_FIELDS) {
    const text = raw[field.key];
    if (typeof text !== "string") {
      throw new DistillationShapeError(`Entry field ${field.key} is missing.`);
    }
    const cleaned = tidy(text);
    if (field.required && cleaned.length === 0) {
      throw new DistillationShapeError(`Entry field ${field.key} is required.`);
    }
    entry[field.key] = cleaned;
  }

  return { entry: entry as MapEntry };
}

// ---------------------------------------------------------------------------
// The closing ritual's choices: the person keeps or drops each field.
// ---------------------------------------------------------------------------

/** Stable ids for the closing ritual's keep/discard choices. */
export function fieldId(key: EntryFieldKey): string {
  return `entry-${key}`;
}

/** The fields that actually have something in them, in page order. */
export function filledFields(
  distillation: Distillation,
): { key: EntryFieldKey; label: string; text: string }[] {
  const entry = distillation.entry;
  if (!entry) return [];
  return ENTRY_FIELDS.filter((field) => entry[field.key].length > 0).map((field) => ({
    key: field.key,
    label: field.label,
    text: entry[field.key],
  }));
}

/**
 * Narrow a distillation to the fields the person chose to keep. The date and
 * title always come with any kept field; choosing no fields means no entry.
 */
export function keepOnly(distillation: Distillation, keptIds: readonly string[]): Distillation {
  const entry = distillation.entry;
  if (!entry) return { entry: null };

  const kept = new Set(keptIds);
  const narrowed: Record<string, string> = { title: entry.title };
  let any = false;
  for (const field of ENTRY_FIELDS) {
    const keep = kept.has(fieldId(field.key)) && entry[field.key].length > 0;
    narrowed[field.key] = keep ? entry[field.key] : "";
    any ||= keep;
  }
  return { entry: any ? (narrowed as MapEntry) : null };
}

/** How many fields have content. Used for receipts and the keep button. */
export function countFields(distillation: Distillation): number {
  return filledFields(distillation).length;
}

// ---------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------

/**
 * "September 26, 2026" — the session's real date, in the person's own time zone
 * when we know it. An unknown or invalid zone falls back to UTC rather than
 * failing a write over a date format.
 */
export function formatEntryDate(date: Date, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "long", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(date);
  }
}

/**
 * "14:35" — the time of day in 24-hour format, in the person's own time zone.
 * Midnight is "00:05", never "24:05". An unknown zone falls back to UTC.
 */
export function formatEntryTime(date: Date, timeZone?: string): string {
  const options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(date);
  }
}

/** "September 26, 2026, 14:35": what goes before the title on an EchoMap entry. */
export function formatEntryStamp(date: Date, timeZone?: string): string {
  return `${formatEntryDate(date, timeZone)}, ${formatEntryTime(date, timeZone)}`;
}

/**
 * Render an entry the way the skill specifies: the dated heading, the filled
 * fields in order, the My Reflection placeholder, then the Echo Thread if there
 * is one ("After the My Reflection placeholder").
 */
export function buildMapPage(entry: MapEntry, dateText: string): MapPage {
  const heading = `${dateText} — ${entry.title}`;
  const field = (key: EntryFieldKey): string | null => {
    const label = ENTRY_FIELDS.find((f) => f.key === key)!.label;
    return entry[key].length > 0 ? `**${label}:** ${entry[key]}` : null;
  };

  const body = ENTRY_FIELDS.filter((f) => f.key !== "thread")
    .map((f) => field(f.key))
    .filter((line): line is string => line !== null);
  const thread = field("thread");

  const markdown = [`### ${heading}`, ...body, MY_REFLECTION, ...(thread ? [thread] : [])].join(
    "\n\n",
  );

  return { heading, markdown };
}
