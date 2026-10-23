/**
 * The EchoHub template, as markdown: the project and the two pages a member's
 * workspace needs.
 *
 * This is the STRUCTURE of Todd's template and nothing of anyone's life: the
 * purpose text and the eight questions, with the answers left for the person to
 * write. It was taken from Todd's example EchoCompass and EchoMap, with every
 * answer and entry left out. The wording is his; if the template changes, this
 * is the one place to change with it.
 *
 * The heading levels are xTiles' own rules for its markdown tools (read from the
 * tools' descriptions): the first `#` is the project title, each `##` is a page,
 * each `###` is a tile. The pages are titled "EchoHub — EchoCompass" and
 * "EchoHub — EchoMap", which is how the template titles them and what
 * lib/xtiles/hub.ts looks for.
 *
 * Pure text, no network: creating the project in xTiles is lib/xtiles/http.ts's job.
 */

export const HUB_PROJECT_TITLE = "EchoHub";
export const COMPASS_PAGE_TITLE = "EchoHub — EchoCompass";
export const MAP_PAGE_TITLE = "EchoHub — EchoMap";

const COMPASS_PURPOSE = [
  "This isn't a profile. It's a starting place.",
  "Answer only what feels right today. You can change any of it later — sometimes the way we describe ourselves changes as we grow. There are no wrong answers here, and nothing is required.",
  "**Written on:** (add today's date when you fill this out)",
];

const MAP_PURPOSE = [
  "The trail of becoming. Each conversation adds an entry below — dated, in your own language, closing with a light left on.",
  "(Entries begin with your first saved session.)",
];

/** The eight prompts, in order, with the helper line under the ones that have one. */
export const COMPASS_QUESTIONS: readonly { readonly question: string; readonly hint?: string }[] = [
  { question: "What should I call you?" },
  {
    question: "Right now, who are you?",
    hint: "Free writing — however you'd describe yourself today, in your own words.",
  },
  { question: "What brought you here?" },
  { question: "What are you hoping changes?" },
  { question: "What's something you're proud of that you don't acknowledge enough?" },
  { question: "What's been weighing on you lately?" },
  { question: "When you're struggling, what helps you feel understood?" },
  {
    question: "What do you want me to gently notice if you keep coming back to it?",
    hint: "If there's a pattern you already suspect in yourself, name it here — and EchoMe will hold it gently, because you asked.",
  },
];

/** The EchoCompass page: the person's own, with the questions and room to answer. */
export function compassMarkdown(): string {
  return [
    `## ${COMPASS_PAGE_TITLE}`,
    "### Purpose",
    ...COMPASS_PURPOSE,
    ...COMPASS_QUESTIONS.flatMap(({ question, hint }, index) => [
      `### ${index + 1}. ${question}`,
      ...(hint ? [hint] : []),
    ]),
  ].join("\n\n");
}

/** The EchoMap page: empty until the first saved conversation adds an entry. */
export function mapMarkdown(): string {
  return [`## ${MAP_PAGE_TITLE}`, "### Purpose", ...MAP_PURPOSE].join("\n\n");
}

/** The whole project, in one go: the title, then both pages. */
export function hubMarkdown(): string {
  return [`# ${HUB_PROJECT_TITLE}`, compassMarkdown(), mapMarkdown()].join("\n\n");
}

// ---------------------------------------------------------------------------
// Taking the template's own words back out.
//
// A member who has not yet answered their EchoCompass has a page that is all
// template: the purpose and eight questions. Handed to Claude as "what this
// person keeps", that would read as though they had written it. These strip
// the template's words and leave only what a person put there.
// ---------------------------------------------------------------------------

/** A line without markdown decoration, spacing or case, for comparing. */
const squash = (line: string): string =>
  line
    .replace(/^[\s#>*\-•]+/, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const COMPASS_BOILERPLATE = new Set(
  [
    "Purpose",
    COMPASS_PAGE_TITLE,
    ...COMPASS_PURPOSE.filter((line) => !line.startsWith("**Written on")),
    ...COMPASS_QUESTIONS.flatMap(({ hint }) => (hint ? [hint] : [])),
  ].map(squash),
);

const MAP_BOILERPLATE = new Set(["Purpose", MAP_PAGE_TITLE, ...MAP_PURPOSE].map(squash));

const QUESTION_KEYS = new Set(COMPASS_QUESTIONS.map(({ question }) => squash(question)));

/** "3. What brought you here?" -> "what brought you here?", or null if it isn't one of ours. */
function questionKey(line: string): string | null {
  const key = squash(line).replace(/^\d+\s*[.)]\s*/, "");
  return QUESTION_KEYS.has(key) ? key : null;
}

/** "Written on: (add today's date…)" with no actual date is still template. */
function isEmptyWrittenOn(line: string): boolean {
  const key = squash(line);
  return key.startsWith("written on") && !/\d/.test(key.replace("today's date", ""));
}

/**
 * The EchoCompass with only what the person wrote: their answers under the
 * questions they answered, and a "Written on" date if they filled one in.
 * Returns an empty string when nothing has been answered.
 */
export function stripCompassTemplate(text: string): string {
  const kept: string[] = [];
  let pending: string | null = null; // a question waiting to see whether it has an answer

  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "") {
      if (pending === null) kept.push(line);
      continue;
    }
    if (questionKey(line) !== null) {
      pending = line;
      continue;
    }
    const key = squash(line);
    if (COMPASS_BOILERPLATE.has(key) || isEmptyWrittenOn(line)) continue;
    if (pending !== null) {
      kept.push(pending);
      pending = null;
    }
    kept.push(line);
  }

  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The EchoMap without its purpose text, leaving only entries. */
export function stripMapTemplate(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !MAP_BOILERPLATE.has(squash(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
