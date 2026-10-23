import { describe, expect, it } from "vitest";

import { formatMemory, parseHubContent } from "@/lib/xtiles/hub";
import {
  COMPASS_PAGE_TITLE,
  COMPASS_QUESTIONS,
  MAP_PAGE_TITLE,
  compassMarkdown,
  hubMarkdown,
  mapMarkdown,
  stripCompassTemplate,
  stripMapTemplate,
} from "@/lib/xtiles/template";

describe("the EchoHub template", () => {
  it("has the eight questions, numbered, in order", () => {
    expect(COMPASS_QUESTIONS).toHaveLength(8);
    const text = compassMarkdown();
    let from = 0;
    COMPASS_QUESTIONS.forEach(({ question }, index) => {
      const at = text.indexOf(`### ${index + 1}. ${question}`, from);
      expect(at, `question ${index + 1}`).toBeGreaterThanOrEqual(from);
      from = at;
    });
  });

  it("titles its pages the way the app looks for them", () => {
    expect(compassMarkdown().startsWith(`## ${COMPASS_PAGE_TITLE}`)).toBe(true);
    expect(mapMarkdown().startsWith(`## ${MAP_PAGE_TITLE}`)).toBe(true);
  });

  it("is found by the same code that reads a member's EchoHub", () => {
    const hub = parseHubContent(hubMarkdown());
    expect(hub.compass?.text).toContain("What should I call you?");
    expect(hub.map?.text).toContain("The trail of becoming");
    // The pages do not run into each other.
    expect(hub.compass?.text).not.toContain("The trail of becoming");
    expect(hub.map?.text).not.toContain("What should I call you?");
  });

  it("leaves every answer empty: it is structure, not anyone's writing", () => {
    for (const line of compassMarkdown().split("\n").filter((l) => l.trim() && !l.startsWith("#"))) {
      expect(line.length).toBeLessThan(260);
    }
    // Only the purpose tile: no entries until a conversation is kept.
    expect(mapMarkdown().match(/^###\s/gm)).toHaveLength(1);
  });
});

describe("taking the template's words back out", () => {
  it("leaves nothing of a Compass nobody has answered", () => {
    expect(stripCompassTemplate(compassMarkdown())).toBe("");
  });

  it("keeps only the questions that have an answer, with the answer", () => {
    const answered = compassMarkdown()
      .replace("### 1. What should I call you?", "### 1. What should I call you?\n\nSam (made up)")
      .replace("### 3. What brought you here?", "### 3. What brought you here?\n\nA made-up reason.");
    const kept = stripCompassTemplate(answered);
    expect(kept).toContain("What should I call you?");
    expect(kept).toContain("Sam (made up)");
    expect(kept).toContain("A made-up reason.");
    // Unanswered questions, the purpose text and the hints are gone.
    expect(kept).not.toContain("What are you hoping changes?");
    expect(kept).not.toContain("This isn't a profile");
    expect(kept).not.toContain("Free writing");
  });

  it("keeps a 'Written on' date someone filled in", () => {
    expect(stripCompassTemplate("**Written on:** 7/4/26 (add today's date when you fill this out)")).toContain("7/4/26");
  });

  it("strips the Map's purpose text but not its entries", () => {
    const withEntry = `${mapMarkdown()}\n\n### October 23, 2026 — A made-up entry\n\n**Theme:** Made up.`;
    const kept = stripMapTemplate(withEntry);
    expect(kept).toContain("October 23, 2026 — A made-up entry");
    expect(kept).not.toContain("The trail of becoming");
    expect(stripMapTemplate(mapMarkdown())).toBe("");
  });

  it("reaches Claude as no memory at all when nothing has been written yet", () => {
    expect(formatMemory(compassMarkdown(), mapMarkdown())).toBeNull();
  });
});
