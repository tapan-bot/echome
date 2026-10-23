import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MapPage } from "@/lib/echo/schema";
import { XTilesNotConnectedError, XTilesWriteError } from "@/lib/xtiles/adapter";
import { HubNotFoundError, XTilesHttpAdapter } from "@/lib/xtiles/http";
import type { XTilesTokens } from "@/lib/xtiles/tokens";
import { startFakeXTiles, type FakeXTiles } from "./helpers/fake-xtiles-server";

/**
 * The real xTiles adapter, end to end, against a stand-in xTiles server. Token
 * storage is replaced with an in-memory map (the encrypted store has its own
 * tests); everything else, the OAuth refresh, the MCP protocol, the parsing,
 * is the real code.
 */

const store = vi.hoisted(() => ({ rows: new Map<string, unknown>() }));

vi.mock("@/lib/xtiles/tokens", () => ({
  readTokens: vi.fn(async (userId: string) => (store.rows.get(userId) as XTilesTokens | undefined) ?? null),
  saveTokens: vi.fn(async (userId: string, tokens: XTilesTokens) => void store.rows.set(userId, tokens)),
  forgetTokens: vi.fn(async (userId: string) => void store.rows.delete(userId)),
}));

const USER = "55555555-5555-4555-8555-555555555555";

const PAGE: MapPage = {
  heading: "October 20, 2026 — One No This Week",
  markdown: [
    "### October 20, 2026 — One No This Week",
    "**Theme:** You are practising saying no.",
    "**A light to leave on:** One no is enough to begin.",
    "**My Reflection:** *(yours to write, whenever you want)*",
  ].join("\n\n"),
};

let xtiles: FakeXTiles;
const adapter = new XTilesHttpAdapter();

function connect(overrides: Partial<XTilesTokens> = {}) {
  store.rows.set(USER, {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    expiresAt: new Date(Date.now() + 3_600_000),
    workspaceId: null,
    clientId: "client-1",
    projectId: null,
    ...overrides,
  } satisfies XTilesTokens);
}

const stored = () => store.rows.get(USER) as XTilesTokens;
const calls = (tool: string) => xtiles.state.mcpCalls.filter((c) => c.method === "tools/call" && c.tool === tool);

beforeEach(async () => {
  store.rows.clear();
  xtiles = await startFakeXTiles();
  process.env.XTILES_MCP_URL = xtiles.mcpUrl;
});

afterEach(async () => {
  delete process.env.XTILES_MCP_URL;
  await xtiles.close();
});

describe("being connected", () => {
  it("is not, until the person has signed in to xTiles", async () => {
    expect(await adapter.isConnected(USER)).toBe(false);
    await expect(adapter.readMemory(USER)).rejects.toBeInstanceOf(XTilesNotConnectedError);
  });

  it("is, once tokens exist, and stays so while an expired token can be refreshed", async () => {
    connect();
    expect(await adapter.isConnected(USER)).toBe(true);
    connect({ expiresAt: new Date(Date.now() - 1000) });
    expect(await adapter.isConnected(USER)).toBe(true);
    // ...but not if it has expired and there is no way to renew it
    connect({ expiresAt: new Date(Date.now() - 1000), refreshToken: null });
    expect(await adapter.isConnected(USER)).toBe(false);
  });
});

describe("reading what the person keeps", () => {
  it("finds their EchoHub (not the other Echo project) and reads the Compass and the Map", async () => {
    connect();
    const memory = await adapter.readMemory(USER);

    expect(memory).toContain("EchoCompass");
    expect(memory).toContain("What should I call you?");
    expect(memory).toContain("Sam");
    expect(memory).toContain("The trail of becoming.");

    // It asked for the hub's content by the id the tool declares (project_id), not the other project's.
    expect(calls("xtiles_get_project_content").map((c) => c.args)).toEqual([{ project_id: "p-hub" }]);
  });

  it("remembers which project is theirs, and does not look it up again", async () => {
    connect();
    await adapter.readMemory(USER);
    expect(stored().projectId).toBe("p-hub");

    xtiles.state.mcpCalls.length = 0;
    await adapter.readMemory(USER);
    expect(calls("xtiles_list_projects")).toHaveLength(0);
  });

  it("includes entries the app has already written, so the next conversation sees them", async () => {
    connect();
    xtiles.state.mapEntries.push("### October 1, 2026 — First\n**Theme:** Beginning.");
    expect(await adapter.readMemory(USER)).toContain("Beginning.");
    const existing = await adapter.readExisting(USER);
    expect(existing.map((entry) => entry.heading)).toEqual(["October 1, 2026 — First"]);
  });

  it("works whether the server replies as JSON or as an event stream", async () => {
    connect();
    xtiles.state.sse = true;
    expect(await adapter.readMemory(USER)).toContain("Sam");
  });

  it("says plainly that the template is missing, rather than failing", async () => {
    connect();
    xtiles.state.hubPresent = false;
    expect(await adapter.checkWorkspace(USER)).toBe("no-hub");
    await expect(adapter.readMemory(USER)).rejects.toBeInstanceOf(HubNotFoundError);
  });

  it("reports a ready workspace as ready", async () => {
    connect();
    expect(await adapter.checkWorkspace(USER)).toBe("ready");
  });

  it("never opens a session it does not close", async () => {
    connect();
    await adapter.readMemory(USER);
    expect(xtiles.state.sessionDeletes).toBe(1);
  });
});

describe("writing an entry", () => {
  it("adds it to the EchoMap page, using the input names the tool declares", async () => {
    connect();
    const result = await adapter.write(USER, PAGE, "receipt-1");

    expect(result.ref).toBe("p-hub/v-map");
    expect(calls("xtiles_create_tiles_from_markdown_by_view")).toHaveLength(1);
    expect(calls("xtiles_create_tiles_from_markdown_by_view")[0]!.args).toEqual({
      view_id: "v-map",
      markdown: PAGE.markdown,
    });
    expect(xtiles.state.mapEntries).toEqual([PAGE.markdown]);
  });

  it("never writes to the EchoCompass, which is the person's own", async () => {
    connect();
    await adapter.write(USER, PAGE, "receipt-1");
    const targets = calls("xtiles_create_tiles_from_markdown_by_view").map((c) => c.args?.view_id);
    expect(targets).not.toContain("v-compass");
  });

  it("does not duplicate an entry when the same write is retried", async () => {
    connect();
    const first = await adapter.write(USER, PAGE, "receipt-1");
    const second = await adapter.write(USER, PAGE, "receipt-1");

    expect(second.ref).toBe(first.ref);
    expect(xtiles.state.mapEntries).toHaveLength(1);
    expect(calls("xtiles_create_tiles_from_markdown_by_view")).toHaveLength(1);
  });

  it("writes a different entry as a new one", async () => {
    connect();
    await adapter.write(USER, PAGE, "receipt-1");
    await adapter.write(
      USER,
      { heading: "October 27, 2026 — Another", markdown: "### October 27, 2026 — Another\n\n**Theme:** A new week." },
      "receipt-2",
    );
    expect(xtiles.state.mapEntries).toHaveLength(2);
  });
});

describe("how writing fails", () => {
  it("tells the closing ritual not to retry when the template is missing", async () => {
    connect();
    xtiles.state.hubPresent = false;
    const error = await adapter.write(USER, PAGE, "r").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XTilesWriteError);
    expect((error as XTilesWriteError).retryable).toBe(false);
  });

  it("tells it to retry when xTiles cannot be reached", async () => {
    connect();
    await xtiles.close();
    const error = await adapter.write(USER, PAGE, "r").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XTilesWriteError);
    expect((error as XTilesWriteError).retryable).toBe(true);
    xtiles = await startFakeXTiles(); // so afterEach has something to close
  });

  it("carries only the kind of failure, never the entry", async () => {
    connect();
    xtiles.state.hubPresent = false;
    const error = await adapter.write(USER, PAGE, "r").catch((e: unknown) => e);
    expect((error as Error).message).not.toContain("saying no");
  });
});

describe("keeping the sign-in alive", () => {
  it("refreshes a token that has expired before using it, and keeps the new one", async () => {
    connect({ expiresAt: new Date(Date.now() - 5_000) });
    await adapter.readMemory(USER);

    expect(xtiles.state.tokenRequests).toHaveLength(1);
    expect(xtiles.state.tokenRequests[0]).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
      client_id: "client-1",
    });
    expect(stored().accessToken).toBe("access-2");
    expect(stored().expiresAt!.getTime()).toBeGreaterThan(Date.now());
    // The project id found along the way survived the refresh being saved.
    expect(stored().projectId).toBe("p-hub");
  });

  it("keeps a rotated refresh token", async () => {
    connect({ expiresAt: new Date(Date.now() - 5_000) });
    xtiles.state.rotateRefreshTo = "refresh-ROTATED";
    await adapter.readMemory(USER);
    expect(stored().refreshToken).toBe("refresh-ROTATED");
  });

  it("refreshes once and tries again when xTiles refuses a token that looked fine", async () => {
    connect();
    xtiles.state.rejectNext = 1; // the first request is refused, as a revoked-then-reissued token would be
    const memory = await adapter.readMemory(USER);
    expect(memory).toContain("Sam");
    expect(xtiles.state.tokenRequests).toHaveLength(1);
  });

  it("asks the person to connect again when the refresh token has been revoked", async () => {
    connect({ expiresAt: new Date(Date.now() - 5_000), refreshToken: "revoked" });
    await expect(adapter.readMemory(USER)).rejects.toBeInstanceOf(XTilesNotConnectedError);
  });

  it("does not loop forever if xTiles keeps refusing", async () => {
    connect();
    xtiles.state.rejectNext = 99;
    await expect(adapter.readMemory(USER)).rejects.toMatchObject({ kind: "unauthorized" });
    expect(xtiles.state.tokenRequests.length).toBeLessThanOrEqual(1);
  });
});

describe("setting up the EchoHub", () => {
  it("creates it from the template when there is none, and can then find it", async () => {
    xtiles.state.hubPresent = false;
    connect();

    expect(await adapter.checkWorkspace(USER)).toBe("no-hub");
    expect(await adapter.createHub(USER)).toBe("created");

    // xTiles' own rules: `#` the project, `##` each page, `###` each tile.
    const markdown = xtiles.state.createdMarkdown ?? "";
    expect(markdown).toMatch(/^# EchoHub\n/);
    expect(markdown).toContain("\n## EchoHub — EchoCompass\n");
    expect(markdown).toContain("\n## EchoHub — EchoMap\n");
    expect(markdown).toContain("### 8. What do you want me to gently notice");

    // The project id came back from xTiles and was kept; the hub is now readable.
    expect(stored().projectId).toBe("p-hub");
    expect(await adapter.checkWorkspace(USER)).toBe("ready");
  });

  it("creates nothing when they already have an EchoHub", async () => {
    connect();
    expect(await adapter.createHub(USER)).toBe("exists");
    expect(calls("xtiles_create_project_from_markdown")).toHaveLength(0);
  });

  it("does not create a second one when a first was made but could not be read back", async () => {
    // The project we remembered still answers, but its content shows no hub.
    xtiles.state.emptyContent = true;
    connect({ projectId: "p-hub" });
    expect(await adapter.createHub(USER)).toBe("exists");
    expect(calls("xtiles_create_project_from_markdown")).toHaveLength(0);
  });

  it("says why when xTiles refuses to create it", async () => {
    xtiles.state.hubPresent = false;
    xtiles.state.createFails = true;
    connect();
    await expect(adapter.createHub(USER)).rejects.toMatchObject({ name: "McpError", kind: "tool" });
    expect(calls("xtiles_create_project_from_markdown")).toHaveLength(1);
  });

  it("finds a page's id from the project structure when the content prints none", async () => {
    xtiles.state.contentAsMarkdown = true;
    connect({ projectId: "p-hub" });

    expect(await adapter.write(USER, PAGE, "key-1")).toMatchObject({ ref: "p-hub/v-map" });
    expect(calls("xtiles_get_project_structure").length).toBeGreaterThan(0);
    expect(calls("xtiles_create_tiles_from_markdown_by_view")).toHaveLength(1);
  });
});
