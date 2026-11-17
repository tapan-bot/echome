import { describe, expect, it } from "vitest";

import type { MapPage } from "@/lib/echo/schema";
import {
  PAGE_TURN_AFTER,
  TURN_TILE_TITLE,
  TurnShapeError,
  buildTurnPage,
  countConversations,
  countTurns,
  entriesAsText,
  isTurnDue,
  pageProjectTitle,
  parseTurnSummary,
} from "@/lib/echo/turn";
import { parseEntries } from "@/lib/xtiles/hub";
import { FakeXTiles } from "@/lib/xtiles/fake";
import { compassMarkdown, mapMarkdown, nextHubMarkdown } from "@/lib/xtiles/template";

const entry = (day: number, title: string): MapPage => ({
  heading: `November ${day}, 2026 — ${title}`,
  markdown: `### November ${day}, 2026 — ${title}\n\n**Theme:** a quiet day about ${title.toLowerCase()}.`,
});

const season = (count: number): MapPage[] => Array.from({ length: count }, (_, i) => entry(i + 1, `Day ${i + 1}`));

const summary = {
  theme: "A season of slowing down.",
  trail: ["November 1 — a quiet start", "November 2 — more room"],
  moved: "Things got lighter.",
  carried: "",
  words: ["a quiet day about day 1"],
  light: "Keep the small light on.",
  thread: "",
};

describe("when the page can be turned", () => {
  it("counts saved conversations, not the purpose tile or earlier turned pages", () => {
    const tile = buildTurnPage(summary, new Date("2026-11-20T12:00:00Z"), "UTC");
    const entries = [{ heading: "Purpose", markdown: "### Purpose" }, tile, ...season(3)];
    expect(countConversations(entries)).toBe(3);
    expect(countTurns(entries)).toBe(1);
  });

  it("is due at the threshold and not before", () => {
    expect(isTurnDue(PAGE_TURN_AFTER - 1)).toBe(false);
    expect(isTurnDue(PAGE_TURN_AFTER)).toBe(true);
    expect(isTurnDue(PAGE_TURN_AFTER + 20)).toBe(true);
  });

  it("names the next EchoHub apart from the first", () => {
    expect(pageProjectTitle(0)).toBe("EchoHub — Page 2");
    expect(pageProjectTitle(1)).toBe("EchoHub — Page 3");
    expect(pageProjectTitle(0)).not.toBe("EchoHub");
  });
});

describe("the Turn the Page tile", () => {
  it("is dated, in Todd's order, with My Reflection left for the person", () => {
    const tile = buildTurnPage(summary, new Date("2026-11-20T12:00:00Z"), "UTC");
    expect(tile.heading).toBe(`${TURN_TILE_TITLE} — November 20, 2026`);
    const order = [
      "Theme of the season",
      "The trail, in brief",
      "What moved",
      "Words worth keeping",
      "A light for the next stretch",
      "My Reflection",
    ].map((label) => tile.markdown.indexOf(label));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(tile.markdown).toContain("(yours to write, whenever you want)");
    // Empty parts are left out rather than written blank.
    expect(tile.markdown).not.toContain("What's still carried");
    expect(tile.markdown).not.toContain("Echo Thread");
  });

  it("is read back as one entry that is not a saved conversation", () => {
    const tile = buildTurnPage(summary, new Date("2026-11-20T12:00:00Z"), "UTC");
    const parsed = parseEntries(`## EchoHub — EchoMap\n\n### Purpose\n\nx\n\n${tile.markdown}`);
    expect(countConversations(parsed)).toBe(0);
    expect(countTurns(parsed)).toBe(1);
  });
});

describe("checking what the model returns", () => {
  const source = entriesAsText(season(3));

  it("keeps only 'words worth keeping' that are really in the entries", () => {
    const parsed = parseTurnSummary(
      { ...summary, words: ["a quiet day about day 1", "something never said at all"] },
      source,
    );
    expect(parsed.words).toEqual(["a quiet day about day 1"]);
  });

  it("refuses a summary with the wrong shape, without quoting it", () => {
    expect(() => parseTurnSummary(null, source)).toThrow(TurnShapeError);
    expect(() => parseTurnSummary({ ...summary, trail: [] }, source)).toThrow(TurnShapeError);
    expect(() => parseTurnSummary({ ...summary, theme: "" }, source)).toThrow(TurnShapeError);
    expect(() => parseTurnSummary({ ...summary, light: 3 }, source)).toThrow(/light/);
  });

  it("keeps each part to one line so it cannot restructure the page", () => {
    const parsed = parseTurnSummary({ ...summary, theme: "line one\n\n### Fake heading" }, source);
    expect(parsed.theme).not.toContain("\n");
  });
});

describe("the next EchoHub", () => {
  it("has both pages and begins its EchoMap with the tile", () => {
    const tile = buildTurnPage(summary, new Date("2026-11-20T12:00:00Z"), "UTC");
    const markdown = nextHubMarkdown({ title: pageProjectTitle(0), turnPageMarkdown: tile.markdown, previousCompass: null });
    expect(markdown.startsWith("# EchoHub — Page 2")).toBe(true);
    expect(markdown).toContain(compassMarkdown());
    expect(markdown).toContain(mapMarkdown());
    expect(markdown.indexOf(mapMarkdown())).toBeLessThan(markdown.indexOf(tile.markdown));
  });

  it("carries the person's own Compass words over, unchanged", () => {
    const markdown = nextHubMarkdown({ title: "EchoHub — Page 2", turnPageMarkdown: "### x", previousCompass: "Words in my own hand." });
    expect(markdown).toContain("Carried over from your previous EchoCompass");
    expect(markdown).toContain("Words in my own hand.");
  });
});

describe("turning the page in a workspace", () => {
  it("starts a new EchoMap from the tile and keeps the old one", async () => {
    const xtiles = new FakeXTiles();
    for (const page of season(PAGE_TURN_AFTER)) await xtiles.write("u1", page, page.heading);

    const before = await xtiles.readTrail("u1");
    expect(countConversations(before.entries)).toBe(PAGE_TURN_AFTER);

    const tile = buildTurnPage(summary, new Date("2026-11-20T12:00:00Z"), "UTC");
    await xtiles.startNextPage("u1", { title: pageProjectTitle(0), turnPage: tile, previousCompass: null });

    const after = await xtiles.readTrail("u1");
    expect(countConversations(after.entries)).toBe(0);
    expect(countTurns(after.entries)).toBe(1);
    // The next conversation is saved after the tile, in the new EchoMap.
    await xtiles.write("u1", entry(25, "Next"), "next");
    expect(countConversations((await xtiles.readTrail("u1")).entries)).toBe(1);
  });

  it("leaves everything as it was when starting the next page fails", async () => {
    const xtiles = new FakeXTiles();
    for (const page of season(PAGE_TURN_AFTER)) await xtiles.write("u1", page, page.heading);
    xtiles.failNextWrite = { reason: "tool: no", retryable: true };

    const tile = buildTurnPage(summary, new Date("2026-11-20T12:00:00Z"), "UTC");
    await expect(
      xtiles.startNextPage("u1", { title: pageProjectTitle(0), turnPage: tile, previousCompass: null }),
    ).rejects.toThrow();
    expect(countConversations((await xtiles.readTrail("u1")).entries)).toBe(PAGE_TURN_AFTER);
  });
});
