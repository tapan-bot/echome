/**
 * Putting spoken words after words that are already in the message box.
 *
 * Pure text in, text out, so it can run in the browser and be tested without one.
 * Nothing here is sent or stored anywhere.
 *
 * Speech recognition capitalises the start of everything it hears, as if each
 * burst of speech were its own sentence. Added after "I keep thinking about my",
 * "Mother" would read as the start of a new sentence. So the boundary is checked:
 * after a finished sentence the new words start with a capital; in the middle of
 * one they continue in lower case, unless the first word is "I" or something
 * that is plainly a name (a word the recogniser capitalised and that is not an
 * ordinary small word).
 */

/** Words that begin a continuing phrase and are never names. Lower-cased when joined mid-sentence. */
const ORDINARY_STARTERS = new Set([
  "a", "an", "the", "and", "but", "or", "so", "because", "if", "when", "while", "as", "that",
  "which", "who", "whom", "whose", "what", "where", "why", "how", "then", "than", "though",
  "although", "since", "until", "unless", "of", "to", "in", "on", "at", "by", "for", "with",
  "from", "into", "about", "over", "under", "after", "before", "like", "my", "your", "his",
  "her", "our", "their", "its", "this", "these", "those", "some", "any", "all", "each",
  "every", "not", "no", "yes", "he", "she", "it", "we", "they", "you", "me", "him", "them",
  "us", "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "have", "has",
  "had", "can", "could", "would", "should", "will", "just", "also", "even", "still", "maybe",
  "really", "very", "too", "now", "there", "here", "more", "most", "much", "many", "other",
]);

/** A finished sentence: ends in . ! ? or … (allowing a closing quote or bracket after it). */
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

function capitalised(text: string): string {
  return text.replace(/^(\W*)(\p{L})/u, (_match, lead: string, first: string) => `${lead}${first.toUpperCase()}`);
}

function continued(text: string): string {
  const word = /^\W*([\p{L}']+)/u.exec(text)?.[1];
  if (!word) return text;
  // "I", "I'm", "I'll": always capital.
  if (/^I(?:'[a-z]+)?$/.test(word)) return text;
  if (!ORDINARY_STARTERS.has(word.toLowerCase())) return text; // possibly a name: leave it
  return text.replace(/^(\W*)(\p{L})/u, (_match, lead: string, first: string) => `${lead}${first.toLowerCase()}`);
}

/**
 * `existing` followed by `spoken`, joined so it reads as one piece of writing:
 * one space between (or the line break that was there), capital letter after a
 * finished sentence, lower case when carrying on from an unfinished one.
 * What was already written is never changed, only what comes after it.
 */
export function joinDictation(existing: string, spoken: string): string {
  const words = spoken.replace(/\s+/g, " ").trim();
  if (words.length === 0) return existing;

  const trailing = /\s*$/.exec(existing)?.[0] ?? "";
  const body = existing.slice(0, existing.length - trailing.length);
  if (body.length === 0) return capitalised(words);

  const startsNewLine = trailing.includes("\n");
  const finished = startsNewLine || SENTENCE_END.test(body);
  // Punctuation the browser put first ("," or "."): it belongs to the words before.
  const leadingPunctuation = /^[,.;:!?]/.test(words);

  const separator = startsNewLine ? trailing : leadingPunctuation ? "" : " ";
  const joined = leadingPunctuation ? words : finished ? capitalised(words) : continued(words);
  return `${body}${separator}${joined}`;
}

/**
 * Is `tidied` plausibly the same words as `spoken`, tidied? It must keep roughly
 * the same length and most of the same words. Anything else (an answer, a
 * summary, a refusal, commentary) is not a tidy-up, and the spoken words are kept.
 */
export function isPlausibleTidy(spoken: string, tidied: string): boolean {
  const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  const before = words(spoken);
  const after = words(tidied);
  if (before.length === 0 || after.length === 0) return false;
  if (after.length < before.length * 0.6 || after.length > before.length * 1.5) return false;
  const remaining = new Map<string, number>();
  for (const word of before) remaining.set(word, (remaining.get(word) ?? 0) + 1);
  let kept = 0;
  for (const word of after) {
    const left = remaining.get(word) ?? 0;
    if (left > 0) {
      kept += 1;
      remaining.set(word, left - 1);
    }
  }
  // A homophone fix or two changes a few words; a different message changes most.
  return kept / before.length >= 0.6;
}
