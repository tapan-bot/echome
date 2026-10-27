import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for xTiles, served on localhost, for tests.
 *
 * It speaks the real wire protocols: OAuth discovery, dynamic client
 * registration, the token endpoint (code exchange and refresh), and MCP over
 * Streamable HTTP, replying either as plain JSON or as an event stream. The tools
 * carry deliberately unlike input names (project_id, view_id) so the tests prove
 * arguments are read from each tool's schema rather than assumed.
 *
 * What it does NOT know is how the real xTiles words its replies. The shapes
 * here are plausible, not authoritative; the point is that EchoMe copes with
 * them, and the first real call will show how close they were.
 */

export interface FakeXTilesState {
  validAccess: string;
  validRefresh: string;
  /** Next access token the token endpoint will issue. */
  issueAccess: string;
  rotateRefreshTo: string | null;
  tokenError: string | null;
  registered: Record<string, unknown>[];
  tokenRequests: Record<string, string>[];
  mcpCalls: { method: string; tool?: string; args?: Record<string, unknown> }[];
  sse: boolean;
  hubPresent: boolean;
  /** Entries already on the EchoMap page. */
  mapEntries: string[];
  /** The markdown the last create-project call was given. */
  createdMarkdown: string | null;
  /** Answer project reads as markdown with no ids, the way a real reply might. */
  contentAsMarkdown: boolean;
  /** Make create-project fail, as a tool refusing would. */
  createFails: boolean;
  /** Answer project reads with a project that has no EchoCompass or EchoMap in it. */
  emptyContent: boolean;
  /** List the hub in a layout whose project ids cannot be read. */
  listUnreadable: boolean;
  /**
   * A deleted hub is gone from the project list but can still answer when asked for
   * by its id, as a project sitting in a trash might. Writing to it fails.
   */
  deletedStillAnswers: boolean;
  /** The project list has not caught up: it leaves the hub out, though it exists and answers by id. */
  hideFromList: boolean;
  /** Reading a project's content fails, as for a project xTiles has not finished setting up. */
  contentFails: boolean;
  /** Make every write to the EchoMap page fail, as xTiles refusing an entry would. */
  rejectWrites: boolean;
  /** Make the next N MCP posts answer 401, as an expired token would. */
  rejectNext: number;
  sessionDeletes: number;
}

export interface FakeXTiles {
  readonly origin: string;
  readonly mcpUrl: string;
  readonly state: FakeXTilesState;
  close(): Promise<void>;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const TOOLS = [
  {
    name: "xtiles_list_projects",
    description: "List projects",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "xtiles_get_project_content",
    description: "Read a project",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" }, cursor: { type: "string" } },
      required: ["project_id"],
    },
  },
  {
    name: "xtiles_create_tiles_from_markdown_by_view",
    description: "Add tiles to a page",
    inputSchema: {
      type: "object",
      properties: { view_id: { type: "string" }, markdown: { type: "string" } },
      required: ["view_id", "markdown"],
    },
  },
  {
    name: "xtiles_create_project_from_markdown",
    description: "Create a project. `#` is the title, `##` a page, `###` a tile.",
    inputSchema: {
      type: "object",
      properties: { markdown: { type: "string" }, workspaceId: { type: "string" } },
      required: ["markdown"],
    },
  },
  {
    name: "xtiles_get_project_structure",
    description: "Every page of a project, with ids",
    inputSchema: {
      type: "object",
      properties: { project_id: { type: "string" } },
      required: ["project_id"],
    },
  },
  { name: "xtiles_get_current_user", inputSchema: { type: "object", properties: {} } },
];

export async function startFakeXTiles(initial: Partial<FakeXTilesState> = {}): Promise<FakeXTiles> {
  const state: FakeXTilesState = {
    validAccess: "access-1",
    validRefresh: "refresh-1",
    issueAccess: "access-2",
    rotateRefreshTo: null,
    tokenError: null,
    registered: [],
    tokenRequests: [],
    mcpCalls: [],
    sse: false,
    hubPresent: true,
    mapEntries: [],
    createdMarkdown: null,
    contentAsMarkdown: false,
    createFails: false,
    emptyContent: false,
    listUnreadable: false,
    deletedStillAnswers: false,
    rejectWrites: false,
    contentFails: false,
    hideFromList: false,
    rejectNext: 0,
    sessionDeletes: 0,
    ...initial,
  };

  let origin = "";

  const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    response.writeHead(status, { "Content-Type": "application/json", ...headers });
    response.end(JSON.stringify(body));
  };

  const rpcReply = (response: ServerResponse, id: unknown, result: unknown, headers: Record<string, string> = {}) => {
    const message = { jsonrpc: "2.0", id, result };
    if (state.sse) {
      response.writeHead(200, { "Content-Type": "text/event-stream", ...headers });
      // A keep-alive comment and an unrelated notification first, as real streams have.
      response.end(`: ping\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message" })}\n\nevent: message\ndata: ${JSON.stringify(message)}\n\n`);
    } else {
      json(response, 200, message, headers);
    }
  };

  const text = (value: unknown) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });

  const hubContent = () => ({
    project: { id: "p-hub", name: "EchoHub" },
    views: [
      {
        id: "v-compass",
        name: "EchoHub — EchoCompass",
        tiles: [
          { title: "Purpose", text: "This isn't a profile. It's a starting place." },
          { title: "What should I call you?", text: "Sam" },
        ],
      },
      {
        id: "v-map",
        name: "EchoHub — EchoMap",
        tiles: [{ title: "Purpose", text: "The trail of becoming." }, ...state.mapEntries.map((entry) => ({ text: entry }))],
      },
    ],
  });

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", origin || "http://localhost");

    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/api/oauth2/auth`,
        token_endpoint: `${origin}/api/oauth2/token`,
        registration_endpoint: `${origin}/api/oauth2/register`,
        scopes_supported: ["openid", "profile", "email", "offline_access"],
      });
    }

    if (url.pathname === "/api/oauth2/register" && request.method === "POST") {
      state.registered.push(JSON.parse(await readBody(request)) as Record<string, unknown>);
      return json(response, 201, { client_id: `client-${state.registered.length}` });
    }

    if (url.pathname === "/api/oauth2/token" && request.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(await readBody(request)));
      state.tokenRequests.push(form);
      if (state.tokenError) return json(response, 400, { error: state.tokenError });
      if (form.grant_type === "refresh_token" && form.refresh_token !== state.validRefresh) {
        return json(response, 400, { error: "invalid_grant" });
      }
      state.validAccess = state.issueAccess;
      if (state.rotateRefreshTo) state.validRefresh = state.rotateRefreshTo;
      return json(response, 200, {
        access_token: state.issueAccess,
        refresh_token: state.rotateRefreshTo ?? state.validRefresh,
        expires_in: 3600,
        token_type: "Bearer",
      });
    }

    if (url.pathname === "/mcp") {
      if (request.method === "DELETE") {
        state.sessionDeletes += 1;
        response.writeHead(200);
        return response.end();
      }
      const authorised = request.headers.authorization === `Bearer ${state.validAccess}`;
      if (!authorised || state.rejectNext > 0) {
        if (state.rejectNext > 0) state.rejectNext -= 1;
        response.writeHead(401, { "WWW-Authenticate": 'Bearer error="invalid_token"' });
        return response.end();
      }

      const message = JSON.parse(await readBody(request)) as {
        id?: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      state.mcpCalls.push({ method: message.method, tool: message.params?.name, args: message.params?.arguments });

      if (message.method === "initialize") {
        return rpcReply(response, message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-xtiles" } }, { "Mcp-Session-Id": "session-1" });
      }
      if (message.method === "notifications/initialized") {
        response.writeHead(202);
        return response.end();
      }
      if (message.method === "tools/list") return rpcReply(response, message.id, { tools: TOOLS });

      if (message.method === "tools/call") {
        const args = message.params?.arguments ?? {};
        switch (message.params?.name) {
          case "xtiles_list_projects":
            if (state.listUnreadable) {
              // The hub is there, in a layout with no id we can read.
              return rpcReply(response, message.id, text("# Workspaces & Projects\n\n## My workspace\n* EchoHub, edited yesterday\n"));
            }
            return rpcReply(
              response,
              message.id,
              text({ projects: [{ id: "p-other", name: "EchoMe" }, ...(state.hubPresent && !state.hideFromList ? [{ id: "p-hub", name: "EchoHub" }] : [])] }),
            );
          case "xtiles_get_project_content":
            if (state.contentFails) return rpcReply(response, message.id, { ...text("Not ready"), isError: true });
            if (args.project_id !== "p-hub" || (!state.hubPresent && !state.deletedStillAnswers)) {
              return rpcReply(response, message.id, { ...text("Project not found"), isError: true });
            }
            if (state.emptyContent) return rpcReply(response, message.id, text("# EchoHub\n\n_Nothing here yet_"));
            if (state.contentAsMarkdown) {
              return rpcReply(
                response,
                message.id,
                text(
                  [
                    "# EchoHub",
                    "## EchoHub — EchoCompass",
                    "### Purpose",
                    "This isn't a profile. It's a starting place.",
                    "## EchoHub — EchoMap",
                    "### Purpose",
                    "The trail of becoming.",
                    ...state.mapEntries,
                  ].join("\n\n"),
                ),
              );
            }
            return rpcReply(response, message.id, text(hubContent()));
          case "xtiles_create_project_from_markdown":
            if (state.createFails) return rpcReply(response, message.id, { ...text("Could not create"), isError: true });
            state.createdMarkdown = String(args.markdown);
            state.hubPresent = true;
            return rpcReply(
              response,
              message.id,
              text({ project_id: "p-hub", view_id: "v-compass", resource_url: "https://example.test/p-hub" }),
            );
          case "xtiles_get_project_structure":
            if (args.project_id !== "p-hub" || (!state.hubPresent && !state.deletedStillAnswers)) {
              return rpcReply(response, message.id, { ...text("Project not found"), isError: true });
            }
            return rpcReply(
              response,
              message.id,
              text({
                pages: [
                  { kind: "PAGE", id: "v-compass", title: "EchoHub — EchoCompass" },
                  { kind: "PAGE", id: "v-map", title: "EchoHub — EchoMap" },
                ],
              }),
            );
          case "xtiles_create_tiles_from_markdown_by_view":
            if (args.view_id !== "v-map" || !state.hubPresent || state.rejectWrites) return rpcReply(response, message.id, { ...text("View not found"), isError: true });
            state.mapEntries.push(String(args.markdown));
            return rpcReply(response, message.id, text("ok"));
          default:
            return rpcReply(response, message.id, { ...text("Unknown tool"), isError: true });
        }
      }
      return json(response, 200, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    }

    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    origin,
    mcpUrl: `${origin}/mcp`,
    state,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
