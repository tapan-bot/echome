import { describe, expect, it } from "vitest";

import {
  buildMapPage,
  countFields,
  DISTILLATION_SCHEMA,
  ENTRY_FIELDS,
  fieldId,
  filledFields,
  formatEntryDate,
  formatEntryStamp,
  formatEntryTime,
  keepOnly,
  MY_REFLECTION,
  parseDistillation,
  type MapEntry,
} from "@/lib/echo/schema";

/**
 * The EchoMap entry format, pinned to Todd's EchoMe skill v3.11, Section 7.
 * If one of these fails, the spec changed or the code drifted from it: check
 * the PDF before "fixing" the test.
 */

const FULL: MapEntry = {
  title: "Just Checking In",
  theme: "You came in tired and left with a plan.",
  moment: "You said out loud that you want to leave the job.",
  leftOff: "How to tell your team.",
  pattern: "",
  sentence: "I already know what I want.",
  light: "Knowing is not the same as deciding, and you did both today.",
  thread: "They usually think out loud before they know what they believe.",
};

const BRIEF: MapEntry = {
  title: "Quick Hello",
  theme: "A short check-in.",
  moment: "",
  leftOff: "",
  pattern: "",
  sentence: "",
  light: "Small visits count.",
  thread: "",
};

describe("the fields", () => {
  it("are the skill's, in the skill's order", () => {
    expect(ENTRY_FIELDS.map((f) => f.label)).toEqual([
      "Theme",
      "Moment that mattered",
      "Where we left off",
      "Pattern noticed",
      "A sentence worth keeping",
      "A light to leave on",
      "Echo Thread",
    ]);
  });

  it("require only Theme and Light: a brief session earns nothing more", () => {
    expect(ENTRY_FIELDS.filter((f) => f.required).map((f) => f.key)).toEqual(["theme", "light"]);
  });

  it("give the model every field plus a title, and no Compass", () => {
    const entry = (DISTILLATION_SCHEMA.properties as Record<string, { required: string[] }>).entry!;
    expect(entry.required).toEqual(["title", ...ENTRY_FIELDS.map((f) => f.key)]);
    expect(JSON.stringify(DISTILLATION_SCHEMA).toLowerCase()).not.toContain("compass");
  });
});

describe("the page", () => {
  it("is dated first, then the fields in order, then My Reflection, then the Echo Thread", () => {
    const page = buildMapPage(FULL, "July 4, 2026");
    expect(page.heading).toBe("July 4, 2026 — Just Checking In");
    expect(page.markdown).toBe(
      [
        "### July 4, 2026 — Just Checking In",
        "**Theme:** You came in tired and left with a plan.",
        "**Moment that mattered:** You said out loud that you want to leave the job.",
        "**Where we left off:** How to tell your team.",
        "**A sentence worth keeping:** I already know what I want.",
        "**A light to leave on:** Knowing is not the same as deciding, and you did both today.",
        "**My Reflection:** *(yours to write, whenever you want)*",
        "**Echo Thread:** They usually think out loud before they know what they believe.",
      ].join("\n\n"),
    );
  });

  it("carries the My Reflection placeholder exactly, on every entry, and never any text in it", () => {
    expect(MY_REFLECTION).toBe("**My Reflection:** *(yours to write, whenever you want)*");
    for (const entry of [FULL, BRIEF]) {
      const { markdown } = buildMapPage(entry, "July 4, 2026");
      expect(markdown).toContain(`\n\n${MY_REFLECTION}`);
      const line = markdown.split("\n\n").find((l) => l.startsWith("**My Reflection:**"));
      expect(line).toBe(MY_REFLECTION);
    }
  });

  it("scales down: a brief session is a Theme and a Light and nothing else", () => {
    const { markdown } = buildMapPage(BRIEF, "July 4, 2026");
    expect(markdown).toBe(
      [
        "### July 4, 2026 — Quick Hello",
        "**Theme:** A short check-in.",
        "**A light to leave on:** Small visits count.",
        MY_REFLECTION,
      ].join("\n\n"),
    );
  });

  it("omits the Echo Thread entirely when there is none", () => {
    expect(buildMapPage(BRIEF, "July 4, 2026").markdown).not.toContain("Echo Thread");
  });
});

describe("the date", () => {
  it("is the long form the skill shows", () => {
    expect(formatEntryDate(new Date("2026-07-04T15:00:00Z"), "UTC")).toBe("July 4, 2026");
  });

  it("falls on the person's own day, not the server's", () => {
    const lateEvening = new Date("2026-09-27T02:30:00Z");
    expect(formatEntryDate(lateEvening, "UTC")).toBe("September 27, 2026");
    expect(formatEntryDate(lateEvening, "America/Chicago")).toBe("September 26, 2026");
  });

  it("falls back to UTC for a time zone it does not know, rather than failing the write", () => {
    expect(formatEntryDate(new Date("2026-07-04T15:00:00Z"), "Not/AZone")).toBe("July 4, 2026");
  });
});

describe("validation", () => {
  it("accepts a well-formed entry and returns it tidied onto single lines", () => {
    const { entry } = parseDistillation({
      entry: { ...FULL, theme: "  Two\n\nlines   and a\t tab  ", title: "## Sneaky\nTitle" },
    });
    expect(entry?.theme).toBe("Two lines and a tab");
    expect(entry?.title).toBe("## Sneaky Title");
    expect(entry?.title).not.toContain("\n");
  });

  it("requires a title, a Theme and a Light", () => {
    expect(() => parseDistillation({ entry: { ...FULL, title: " " } })).toThrow(/no title/);
    expect(() => parseDistillation({ entry: { ...FULL, theme: "" } })).toThrow(/theme is required/);
    expect(() => parseDistillation({ entry: { ...FULL, light: "" } })).toThrow(/light is required/);
  });

  it("lets every other field be empty", () => {
    expect(parseDistillation({ entry: BRIEF }).entry).toEqual(BRIEF);
  });

  it("treats a null entry as nothing to keep", () => {
    expect(parseDistillation({ entry: null })).toEqual({ entry: null });
  });
});

describe("choosing what to keep", () => {
  it("lists only the fields that have something in them", () => {
    expect(filledFields({ entry: BRIEF }).map((f) => f.key)).toEqual(["theme", "light"]);
    expect(countFields({ entry: FULL })).toBe(6);
    expect(countFields({ entry: null })).toBe(0);
  });

  it("keeps the ticked fields and blanks the rest", () => {
    const kept = keepOnly({ entry: FULL }, [fieldId("theme"), fieldId("sentence")]).entry;
    expect(kept?.theme).toBe(FULL.theme);
    expect(kept?.sentence).toBe(FULL.sentence);
    expect(kept?.moment).toBe("");
    expect(kept?.light).toBe("");
  });

  it("ignores an id it does not know, and an id for a field that was empty", () => {
    expect(keepOnly({ entry: BRIEF }, ["entry-nonsense", fieldId("moment")]).entry).toBeNull();
  });
});

describe("the time on an entry", () => {
  const afternoon = new Date("2026-09-26T14:35:00Z");

  it("is 24-hour, in the person's own time zone", () => {
    expect(formatEntryTime(afternoon, "UTC")).toBe("14:35");
    expect(formatEntryTime(afternoon, "America/Chicago")).toBe("09:35");
    expect(formatEntryTime(new Date("2026-09-26T21:05:00Z"), "UTC")).toBe("21:05");
  });

  it("reads midnight as 00:05, never 24:05", () => {
    expect(formatEntryTime(new Date("2026-09-27T00:05:00Z"), "UTC")).toBe("00:05");
  });

  it("falls back to UTC for a zone it does not know", () => {
    expect(formatEntryTime(afternoon, "Not/AZone")).toBe("14:35");
  });

  it("goes after the date, before the title", () => {
    expect(formatEntryStamp(afternoon, "UTC")).toBe("September 26, 2026, 14:35");
    const page = buildMapPage(BRIEF, formatEntryStamp(afternoon, "UTC"));
    expect(page.heading).toBe(`September 26, 2026, 14:35 — ${BRIEF.title}`);
    expect(page.markdown.startsWith("### September 26, 2026, 14:35 — ")).toBe(true);
  });

  it("keeps the date on the person's own day, with the time beside it", () => {
    const lateEvening = new Date("2026-09-27T02:30:00Z");
    expect(formatEntryStamp(lateEvening, "America/Chicago")).toBe("September 26, 2026, 21:30");
  });
});
