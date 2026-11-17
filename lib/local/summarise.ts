import "server-only";

import type { MapPage } from "@/lib/echo/schema";
import { isConversationEntry, type TurnSummary } from "@/lib/echo/turn";
import { assertLocalMode } from "@/lib/local/mode";

/**
 * A stand-in for the season summary, used only in local mode with no API key, so the page turn
 * can be walked through without credentials. It lists the trail from the entries' own headings
 * and says plainly that it is a stand-in; it does no analysis and does not pretend to.
 */
export function summariseLocally(entries: readonly MapPage[]): TurnSummary {
  assertLocalMode();
  const conversations = entries.filter((entry) => isConversationEntry(entry.heading));
  return {
    theme: `(Local stand-in) ${conversations.length} saved conversations, gathered into one page.`,
    trail: conversations.map((entry) => entry.heading),
    moved: "(Local stand-in) A real summary reads the entries and says what moved.",
    carried: "",
    words: [],
    light: "(Local stand-in) A real summary leaves a light for the next stretch.",
    thread: "",
  };
}
