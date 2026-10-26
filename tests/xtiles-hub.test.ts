import { describe, expect, it } from "vitest";

import type { MapPage } from "@/lib/echo/schema";
import {
  parseCreated,
  alreadyThere,
  buildArguments,
  collectNamed,
  formatMemory,
  parseEntries,
  parseHubContent,
  parseProjects,
  pickHub,
} from "@/lib/xtiles/hub";
import type { ToolInfo } from "@/lib/xtiles/mcp";

/**
 * Making sense of xTiles' tool inputs and outputs, with no network. xTiles
 * documents tool NAMES but not exact shapes, so these tests deliberately feed
 * the parsers several plausible shapes: if the real one is any of them, it works.
 */

const tool = (properties: string[], required: string[] = []): ToolInfo => ({
  name: "some_tool",
  inputSchema: { properties: Object.fromEntries(properties.map((name) => [name, { type: "string" }])), required },
});

describe("filling a tool's arguments from its own schema", () => {
  it("uses whatever names the tool declares", () => {
    expect(buildArguments(tool(["project_id"], ["project_id"]), { projectId: "p1" })).toEqual({ project_id: "p1" });
    expect(buildArguments(tool(["projectId"], ["projectId"]), { projectId: "p1" })).toEqual({ projectId: "p1" });
    expect(buildArguments(tool(["ProjectID"]), { projectId: "p1" })).toEqual({ ProjectID: "p1" });
  });

  it("treats a page and a view as the same thing, as xTiles does", () => {
    expect(buildArguments(tool(["view_id"]), { viewId: "v1" })).toEqual({ view_id: "v1" });
    expect(buildArguments(tool(["pageId"]), { viewId: "v1" })).toEqual({ pageId: "v1" });
  });

  it("finds the markdown input under its likely names", () => {
    for (const name of ["markdown", "content", "text", "body", "markdown_content"]) {
      expect(buildArguments(tool([name]), { markdown: "# hi" })).toEqual({ [name]: "# hi" });
    }
  });

  it("fills several inputs at once and leaves out ones it has no value for", () => {
    expect(
      buildArguments(tool(["view_id", "markdown", "cursor"], ["view_id", "markdown"]), { viewId: "v", markdown: "m" }),
    ).toEqual({ view_id: "v", markdown: "m" });
  });

  it("names a required input it cannot fill, instead of sending a call that is bound to fail", () => {
    const error = (() => {
      try {
        buildArguments(tool(["workspace_slug"], ["workspace_slug"]), { projectId: "p" });
      } catch (e) {
        return e as Error;
      }
    })();
    expect(error?.message).toContain("workspace_slug");
    expect(error?.message).toContain("some_tool");
  });

  it("falls back to conventional names when the tool declares no schema", () => {
    expect(buildArguments({ name: "x" }, { projectId: "p", markdown: "m" })).toEqual({ projectId: "p", markdown: "m" });
  });
});

describe("finding the person's projects", () => {
  it("reads a JSON object with a list of projects", () => {
    const text = JSON.stringify({ projects: [{ id: "p1", name: "EchoMe" }, { id: "p2", name: "EchoHub" }] });
    expect(parseProjects(text)).toEqual([
      { id: "p1", name: "EchoMe" },
      { id: "p2", name: "EchoHub" },
    ]);
  });

  it("reads a bare JSON array, numeric ids, and 'title' in place of 'name'", () => {
    expect(parseProjects(JSON.stringify([{ id: 7, title: "EchoHub" }]))).toEqual([{ id: "7", name: "EchoHub" }]);
  });

  it("reads projects nested deeper in the reply", () => {
    const text = JSON.stringify({ data: { workspace: { projects: [{ uuid: "abc-123", name: "EchoHub" }] } } });
    expect(parseProjects(text)).toEqual([{ id: "abc-123", name: "EchoHub" }]);
  });

  it("reads markdown lists with the id written in a few ways", () => {
    expect(parseProjects("- EchoHub (id: hub12345)\n- EchoMe (id: me123456)")).toEqual([
      { id: "hub12345", name: "EchoHub" },
      { id: "me123456", name: "EchoMe" },
    ]);
    expect(parseProjects("[EchoHub](https://xtiles.app/project/hub12345)")).toEqual([
      { id: "hub12345", name: "EchoHub" },
    ]);
  });

  it("picks the project named exactly EchoHub, and never an Echo-something-else", () => {
    expect(pickHub([{ id: "1", name: "EchoMe" }, { id: "2", name: "  echohub " }])?.id).toBe("2");
    expect(pickHub([{ id: "1", name: "EchoMe" }, { id: "3", name: "EchoHub Archive" }])).toBeNull();
    expect(pickHub([])).toBeNull();
  });

  it("forgives case, emoji and punctuation in the hub's name, but not extra words", () => {
    expect(pickHub([{ id: "1", name: "🧭 EchoHub™" }])?.id).toBe("1");
    expect(pickHub([{ id: "1", name: "Echo-Hub" }])?.id).toBe("1");
    expect(pickHub([{ id: "1", name: "My EchoHub" }])).toBeNull();
  });
});

describe("reading the EchoCompass and EchoMap", () => {
  it("reads them from JSON, keeping the page id that writing needs", () => {
    const text = JSON.stringify({
      views: [
        { id: "v1", name: "EchoCompass", tiles: [{ title: "What should I call you?", text: "Sam" }] },
        { id: "v2", name: "EchoMap", tiles: [{ text: "### Oct 1, 2026 — First" }] },
        { id: "v3", name: "EchoLinks", tiles: [{ text: "https://app.echomechat.ai/login" }] },
      ],
    });
    const hub = parseHubContent(text);
    expect(hub.compass?.id).toBe("v1");
    expect(hub.compass?.text).toContain("Sam");
    expect(hub.map?.id).toBe("v2");
    expect(hub.map?.text).toContain("Oct 1, 2026");
    // The page's own name is not part of its text, and neighbouring pages stay out.
    expect(hub.map?.text).not.toContain("EchoMap");
    expect(hub.map?.text).not.toContain("echomechat.ai/login");
  });

  it("finds pages that picked up a decoration, preferring the plain name", () => {
    const text = JSON.stringify({
      views: [
        { id: "v1", name: "🧭 EchoCompass", text: "Sam" },
        { id: "v2", name: "EchoMap entries 2025", text: "old" },
        { id: "v3", name: "My EchoMap", text: "new" },
      ],
    });
    const hub = parseHubContent(text);
    expect(hub.compass?.id).toBe("v1");
    // Neither is exactly EchoMap, so the shortest name containing it wins.
    expect(hub.map?.id).toBe("v3");
  });

  it("finds the pages as the EchoHub template actually titles them: 'EchoHub — EchoMap'", () => {
    const json = JSON.stringify({
      views: [
        { id: "v1", name: "EchoHub — EchoCompass", text: "1. What should I call you? Sam" },
        { id: "v2", name: "EchoHub — EchoMap", text: "### July 21, 2026 — A made-up entry" },
      ],
    });
    const fromJson = parseHubContent(json);
    expect(fromJson.compass?.id).toBe("v1");
    expect(fromJson.map?.id).toBe("v2");

    const fromMarkdown = parseHubContent(
      [
        "# EchoHub — EchoCompass",
        "1. What should I call you? Sam",
        "# EchoHub — EchoMap",
        "### July 21, 2026 — A made-up entry",
        "**Theme:** Made up.",
      ].join("\n"),
    );
    expect(fromMarkdown.compass?.text).toContain("Sam");
    expect(fromMarkdown.map?.text).toContain("July 21, 2026");
    expect(fromMarkdown.map?.text).not.toContain("Sam");
  });

  it("reads them from markdown sections, with the id when one is printed", () => {
    const text = [
      "# EchoHub",
      "## EchoCompass (id: view-aaa111)",
      "What should I call you? Sam",
      "## EchoMap (id: view-bbb222)",
      "### Oct 1, 2026 — First",
      "**Theme:** Starting.",
      "## EchoLinks",
      "A link",
    ].join("\n");
    const hub = parseHubContent(text);
    expect(hub.compass?.id).toBe("view-aaa111");
    expect(hub.compass?.text).toBe("What should I call you? Sam");
    expect(hub.map?.id).toBe("view-bbb222");
    expect(hub.map?.text).toContain("### Oct 1, 2026 — First");
    expect(hub.map?.text).not.toContain("A link");
  });

  it("reports a missing page as missing, and notes a cursor when there is more to fetch", () => {
    const hub = parseHubContent(JSON.stringify({ views: [{ id: "v1", name: "EchoCompass", tiles: [] }], nextCursor: "c2" }));
    expect(hub.compass?.id).toBe("v1");
    expect(hub.map).toBeNull();
    expect(hub.cursor).toBe("c2");
  });

  it("finds nothing in a project that is not an EchoHub", () => {
    const hub = parseHubContent(JSON.stringify({ views: [{ id: "v1", name: "Shopping list", tiles: [] }] }));
    expect(hub.compass).toBeNull();
    expect(hub.map).toBeNull();
  });

  it("collects named objects at any depth without choking on cycles of nothing", () => {
    expect(collectNamed({ a: [{ b: { id: "x", name: "Deep" } }], id: "top", name: "Top" }).map((n) => n.name)).toEqual([
      "Top",
      "Deep",
    ]);
  });
});

describe("the entries on the EchoMap", () => {
  const MAP = [
    "The trail of becoming.",
    "### October 1, 2026 — First",
    "**Theme:** Starting out.",
    "**A light to leave on:** Begin.",
    "### October 8, 2026 — Second",
    "**Theme:** Going on.",
  ].join("\n");

  it("splits the page into its dated entries", () => {
    const entries = parseEntries(MAP);
    expect(entries.map((e) => e.heading)).toEqual(["October 1, 2026 — First", "October 8, 2026 — Second"]);
    expect(entries[0]!.markdown).toContain("Starting out.");
    expect(entries[0]!.markdown).not.toContain("Going on.");
  });

  const page: MapPage = {
    heading: "October 8, 2026 — Second",
    markdown: "### October 8, 2026 — Second\n\n**Theme:** Going on.\n\n**My Reflection:** *(yours to write, whenever you want)*",
  };

  it("knows an entry is already there, so a retry cannot duplicate it", () => {
    expect(alreadyThere(MAP, page)).toBe(true);
  });

  it("does not mistake a different entry on the same day for the same one", () => {
    expect(alreadyThere(MAP, { ...page, markdown: page.markdown.replace("Going on.", "A different thought.") })).toBe(false);
    expect(alreadyThere(MAP, { heading: "October 9, 2026 — Third", markdown: "### October 9, 2026 — Third\n\n**Theme:** New." })).toBe(false);
  });

  it("is not thrown by spacing or capital letters", () => {
    expect(alreadyThere(MAP.replaceAll("\n", "\n\n").toUpperCase(), page)).toBe(true);
  });
});

describe("what is handed to a conversation", () => {
  it("is nothing at all when there is nothing there", () => {
    expect(formatMemory(null, null)).toBeNull();
    expect(formatMemory("  ", "")).toBeNull();
  });

  it("labels the person's own words and the trail separately", () => {
    const text = formatMemory("Call me Sam.", "### Oct 1 — First")!;
    expect(text).toContain("EchoCompass (written by the person");
    expect(text).toContain("Call me Sam.");
    expect(text).toContain("EchoMap (the trail");
    expect(text).toContain("### Oct 1 — First");
  });

  it("keeps the Compass whole and drops the OLDEST map entries when the trail is long", () => {
    const entries = Array.from({ length: 40 }, (_, i) => `### Day ${i} — T\n${"x".repeat(500)} entry-${i}`);
    const text = formatMemory("Sam.", entries.join("\n"), 5_000)!;
    expect(text).toContain("Sam.");
    expect(text).toContain("entry-39");
    expect(text).not.toContain("entry-0 ");
    expect(text).toContain("Older entries are not shown");
    expect(text.length).toBeLessThan(5_000 + 600);
  });
});

describe("reading what xTiles says after creating a project", () => {
  it("reads the ids from JSON", () => {
    expect(parseCreated(JSON.stringify({ project_id: "proj-12345", view_id: "view-67890", resource_url: "https://x.test/a" }))).toEqual({
      projectId: "proj-12345",
      viewId: "view-67890",
    });
    expect(parseCreated(JSON.stringify({ result: { projectId: "proj-abcdef" } })).projectId).toBe("proj-abcdef");
  });

  it("reads them when written out as text", () => {
    const text = "Created.\n- project_id: proj-12345\n- view_id: `view-67890`";
    expect(parseCreated(text)).toEqual({ projectId: "proj-12345", viewId: "view-67890" });
  });

  it("says nothing was found when there is no id", () => {
    expect(parseCreated("Done.")).toEqual({ projectId: null, viewId: null });
  });
});

describe("the project list as xTiles really words it", () => {
  const REAL_SHAPE = "# Workspaces & Projects\n\n## My workspace (personal)\n- **EchoHub** (0123456789abcdef01234567)\n";

  it("reads a plain id in parentheses after a bold name", () => {
    expect(parseProjects(REAL_SHAPE)).toEqual([{ id: "0123456789abcdef01234567", name: "EchoHub" }]);
    expect(pickHub(parseProjects(REAL_SHAPE))?.id).toBe("0123456789abcdef01234567");
  });

  it("does not take a workspace heading or an empty workspace for a project", () => {
    expect(parseProjects("# Workspaces & Projects\n\n## My workspace (personal)\n_No projects_\n")).toEqual([]);
  });

  it("reads several projects across several workspaces", () => {
    const text = [
      "# Workspaces & Projects",
      "",
      "## My workspace (personal)",
      "- **EchoHub** (0123456789abcdef01234567)",
      "- **Garden plans** (89abcdef0123456789abcdef)",
      "",
      "## Team (shared)",
      "- **Budget** (fedcba9876543210fedcba98)",
    ].join("\n");
    expect(parseProjects(text).map((p) => p.name)).toEqual(["EchoHub", "Garden plans", "Budget"]);
  });
});

describe("a project as xTiles really reads it out", () => {
  const REAL_SHAPE = [
    "**Project:** EchoHub",
    "**Project ID:** 0123456789abcdef01234567",
    "**Format:** markdown",
    "**Views in this page:** 0123456789abcdef01234568, 0123456789abcdef01234569",
    "**End of content reached.**",
    "",
    "--- page markdown below (patch matches against this part only) ---",
    "",
    "# EchoHub",
    "",
    "## EchoHub — EchoCompass",
    "### Purpose",
    "",
    "This isn't a profile. It's a starting place.",
    "",
    "### 1. What should I call you?",
    "",
    "## EchoHub — EchoMap",
    "### Purpose",
    "",
    "The trail of becoming.",
    "",
    "### October 23, 2026 — A made-up entry",
    "",
    "**Theme:** Made up.",
    "",
  ].join("\n");

  it("finds both pages, and gives each the id that is in the same position", () => {
    const hub = parseHubContent(REAL_SHAPE);
    expect(hub.compass?.id).toBe("0123456789abcdef01234568");
    expect(hub.map?.id).toBe("0123456789abcdef01234569");
    expect(hub.compass?.text).toContain("What should I call you?");
    expect(hub.map?.text).toContain("A made-up entry");
    expect(hub.map?.text).not.toContain("What should I call you?");
  });

  it("reads the entries on the Map as the tiles they are", () => {
    const entries = parseEntries(parseHubContent(REAL_SHAPE).map?.text ?? "");
    expect(entries.map((entry) => entry.heading)).toEqual(["Purpose", "October 23, 2026 — A made-up entry"]);
  });

  it("gives no id rather than a wrong one when the counts do not agree", () => {
    const broken = REAL_SHAPE.replace(", 0123456789abcdef01234569", "");
    expect(parseHubContent(broken).map?.id).toBeNull();
  });
});
