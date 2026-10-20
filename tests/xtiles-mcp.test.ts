import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpError, McpSession, parseRpcBody } from "@/lib/xtiles/mcp";
import { startFakeXTiles, type FakeXTiles } from "./helpers/fake-xtiles-server";

/** The MCP client against a stand-in server, plus the reply parser on its own. */

let xtiles: FakeXTiles;

beforeEach(async () => {
  xtiles = await startFakeXTiles();
  process.env.XTILES_MCP_URL = xtiles.mcpUrl;
});

afterEach(async () => {
  delete process.env.XTILES_MCP_URL;
  await xtiles.close();
});

describe("a session", () => {
  for (const sse of [false, true]) {
    describe(sse ? "when the server replies as an event stream" : "when the server replies as plain JSON", () => {
      beforeEach(() => {
        xtiles.state.sse = sse;
      });

      it("opens, lists tools and calls one", async () => {
        const session = await McpSession.open("access-1");
        const tools = await session.listTools();
        expect(tools.map((tool) => tool.name)).toContain("xtiles_list_projects");

        const text = await session.callTool("xtiles_list_projects", {});
        expect(JSON.parse(text).projects.map((p: { name: string }) => p.name)).toEqual(["EchoMe", "EchoHub"]);
        await session.close();
      });
    });
  }

  it("does the protocol handshake in order: initialize, then initialized", async () => {
    await McpSession.open("access-1");
    expect(xtiles.state.mcpCalls.map((call) => call.method).slice(0, 2)).toEqual([
      "initialize",
      "notifications/initialized",
    ]);
  });

  it("sends the bearer token, and the session id once the server gives one", async () => {
    const session = await McpSession.open("access-1");
    await session.listTools();
    await session.close();
    // close() sends a DELETE for the session the server created
    expect(xtiles.state.sessionDeletes).toBe(1);
  });

  it("asks for the tool list only once per session", async () => {
    const session = await McpSession.open("access-1");
    await session.listTools();
    await session.listTools();
    await session.requireTools(["xtiles_list_projects"]);
    expect(xtiles.state.mcpCalls.filter((call) => call.method === "tools/list")).toHaveLength(1);
  });

  it("names the tools that are missing rather than failing later and mysteriously", async () => {
    const session = await McpSession.open("access-1");
    const error = await session.requireTools(["xtiles_list_projects", "xtiles_no_such_tool"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).kind).toBe("protocol");
    expect((error as McpError).message).toContain("xtiles_no_such_tool");
    expect((error as McpError).message).not.toContain("xtiles_list_projects");
  });
});

describe("failures", () => {
  it("reports a refused token as 'unauthorized', which is the cue to refresh", async () => {
    const error = await McpSession.open("a-token-the-server-does-not-know").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).kind).toBe("unauthorized");
    expect((error as McpError).retryable).toBe(false);
  });

  it("reports a tool that ran and failed as a 'tool' error", async () => {
    const session = await McpSession.open("access-1");
    const error = await session.callTool("xtiles_get_project_content", { project_id: "nope" }).catch((e: unknown) => e);
    expect((error as McpError).kind).toBe("tool");
  });

  it("reports an unreachable server as 'network', which is worth retrying", async () => {
    await xtiles.close();
    const error = await McpSession.open("access-1").catch((e: unknown) => e);
    expect((error as McpError).kind).toBe("network");
    expect((error as McpError).retryable).toBe(true);
    // afterEach closes it again; make that harmless
    xtiles = await startFakeXTiles();
  });

  it("never puts what it sent into an error", async () => {
    const session = await McpSession.open("access-1");
    const secret = "a private sentence nobody should see in a log";
    const error = await session
      .callTool("xtiles_create_tiles_from_markdown_by_view", { view_id: "wrong", markdown: secret })
      .catch((e: unknown) => e);
    expect((error as Error).message).not.toContain(secret);
  });
});

describe("reading replies", () => {
  it("reads a plain JSON reply", () => {
    expect(parseRpcBody("application/json", '{"jsonrpc":"2.0","id":3,"result":{"ok":true}}', 3)?.result).toEqual({
      ok: true,
    });
  });

  it("picks the reply with the matching id out of an event stream, skipping noise", () => {
    const body = [
      ": keep-alive",
      "",
      'data: {"jsonrpc":"2.0","method":"notifications/progress"}',
      "",
      'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"answer":42}}',
      "",
    ].join("\n");
    expect(parseRpcBody("text/event-stream; charset=utf-8", body, 7)?.result).toEqual({ answer: 42 });
  });

  it("copes with a data payload split across lines, and CRLF line endings", () => {
    const body = 'data: {"jsonrpc":"2.0",\r\ndata: "id":1,"result":{"x":1}}\r\n\r\n';
    expect(parseRpcBody("text/event-stream", body, 1)?.result).toEqual({ x: 1 });
  });

  it("returns null for an empty body (a notification's 202) and for rubbish", () => {
    expect(parseRpcBody("application/json", "", 1)).toBeNull();
    expect(parseRpcBody("application/json", "<html>nope</html>", 1)).toBeNull();
  });
});
