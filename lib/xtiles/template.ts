/**
 * The EchoHub template, as markdown: the two pages a member's workspace needs.
 *
 * This is the STRUCTURE of Todd's template and nothing of anyone's life: the
 * purpose text and the eight questions, with the answers left for the person to
 * write. It was taken from Todd's example EchoCompass and EchoMap, with every
 * answer and entry left out. The wording is his; if the template changes, this
 * is the one place to change with it.
 *
 * Page titles are "EchoHub — EchoCompass" and "EchoHub — EchoMap", which is how
 * the template titles them, and what lib/xtiles/hub.ts looks for.
 *
 * Pure text, no network: creating the project in xTiles is lib/xtiles/http.ts's job.
 */

export const HUB_PROJECT_TITLE = "EchoHub";
export const COMPASS_PAGE_TITLE = "EchoHub — EchoCompass";
export const MAP_PAGE_TITLE = "EchoHub — EchoMap";

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
    `# ${COMPASS_PAGE_TITLE}`,
    "## Purpose",
    "This isn't a profile. It's a starting place.",
    "Answer only what feels right today. You can change any of it later — sometimes the way we describe ourselves changes as we grow. There are no wrong answers here, and nothing is required.",
    "**Written on:** (add today's date when you fill this out)",
    ...COMPASS_QUESTIONS.flatMap(({ question, hint }, index) => [
      `## ${index + 1}. ${question}`,
      ...(hint ? [hint] : []),
    ]),
  ].join("\n\n");
}

/** The EchoMap page: empty until the first saved conversation adds an entry. */
export function mapMarkdown(): string {
  return [
    `# ${MAP_PAGE_TITLE}`,
    "## Purpose",
    "The trail of becoming. Each conversation adds an entry below — dated, in your own language, closing with a light left on.",
    "(Entries begin with your first saved session.)",
  ].join("\n\n");
}
