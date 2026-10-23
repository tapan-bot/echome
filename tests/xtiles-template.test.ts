import { describe, expect, it } from "vitest";

import { parseHubContent } from "@/lib/xtiles/hub";
import {
  COMPASS_PAGE_TITLE,
  COMPASS_QUESTIONS,
  MAP_PAGE_TITLE,
  compassMarkdown,
  mapMarkdown,
} from "@/lib/xtiles/template";

describe("the EchoHub template", () => {
  it("has the eight questions, numbered, in order", () => {
    expect(COMPASS_QUESTIONS).toHaveLength(8);
    const text = compassMarkdown();
    let from = 0;
    COMPASS_QUESTIONS.forEach(({ question }, index) => {
      const at = text.indexOf(`## ${index + 1}. ${question}`, from);
      expect(at, `question ${index + 1}`).toBeGreaterThanOrEqual(from);
      from = at;
    });
  });

  it("titles its pages the way the app looks for them", () => {
    expect(compassMarkdown().startsWith(`# ${COMPASS_PAGE_TITLE}`)).toBe(true);
    expect(mapMarkdown().startsWith(`# ${MAP_PAGE_TITLE}`)).toBe(true);
  });

  it("is found by the same code that reads a member's EchoHub", () => {
    const hub = parseHubContent([compassMarkdown(), mapMarkdown()].join("\n\n"));
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
    expect(mapMarkdown()).not.toMatch(/###\s/);
  });
});
