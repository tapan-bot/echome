import "server-only";

import { mcpUrl } from "@/lib/xtiles/oauth";

/**
 * A small MCP client: just enough of the protocol to list tools and call them
 * over "Streamable HTTP". Written by hand rather than pulling in the MCP SDK,
 * to keep the dependency list short, and because the part we use is small.
 *
 * Each logical operation opens a session, does its work and closes it. There is
 * no long-lived connection to keep alive on a serverless host.
 *
 * Errors carry a kind and a short message from the protocol layer. They never
 * include anything the person wrote: requests are not echoed into errors.
 */

const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 20_000;

export type McpErrorKind =
  /** The token was refused. Refresh it, or the person has to sign in again. */
  | "unauthorized"
  /** The server could not be reached, or answered 5xx. Worth trying again. */
  | "network"
  /** The server answered, but not the way the protocol or our expectations say. */
  | "protocol"
  /** A tool ran and reported a failure. */
  | "tool";

export class McpError extends Error {
  override readonly name = "McpError";
  constructor(
    readonly kind: McpErrorKind,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export interface ToolInfo {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: {
    readonly properties?: Record<string, unknown>;
    readonly required?: readonly string[];
  };
}

interface JsonRpcResponse {
  readonly id?: number | string | null;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

/** Pull the JSON-RPC reply out of a plain JSON body or a server-sent-event stream. */
export function parseRpcBody(contentType: string, body: string, id: number): JsonRpcResponse | null {
  if (body.trim().length === 0) return null;

  if (contentType.includes("text/event-stream")) {
    let fallback: JsonRpcResponse | null = null;
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        const message = JSON.parse(data) as JsonRpcResponse;
        if (message.id === id) return message;
        if (message.result !== undefined || message.error !== undefined) fallback ??= message;
      } catch {
        // A keep-alive or a partial line. Skip it.
      }
    }
    return fallback;
  }

  try {
    const parsed = JSON.parse(body) as JsonRpcResponse | JsonRpcResponse[];
    if (Array.isArray(parsed)) return parsed.find((message) => message.id === id) ?? parsed[0] ?? null;
    return parsed;
  } catch {
    return null;
  }
}

export class McpSession {
  private nextId = 1;
  private sessionId: string | null = null;
  private protocolVersion = PROTOCOL_VERSION;
  private tools: ToolInfo[] | null = null;

  private constructor(private readonly accessToken: string) {}

  /** Open a session: the protocol's initialize handshake. */
  static async open(accessToken: string): Promise<McpSession> {
    const session = new McpSession(accessToken);
    const init = (await session.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "EchoMe", version: "1.0.0" },
    })) as { protocolVersion?: string } | null;
    if (typeof init?.protocolVersion === "string") session.protocolVersion = init.protocolVersion;
    await session.notify("notifications/initialized");
    return session;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": this.protocolVersion,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return headers;
  }

  private async post(payload: object): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(mcpUrl(), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new McpError("network", true, "The xTiles server could not be reached.");
    }
    if (response.status === 401 || response.status === 403) {
      throw new McpError("unauthorized", false, "xTiles did not accept the sign-in.");
    }
    if (response.status >= 500) throw new McpError("network", true, `xTiles answered ${response.status}.`);
    if (!response.ok) throw new McpError("protocol", false, `xTiles answered ${response.status}.`);

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    return response;
  }

  private async request(method: string, params: object): Promise<unknown> {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: "2.0", id, method, params });
    const body = await response.text();
    const message = parseRpcBody(response.headers.get("content-type") ?? "", body, id);
    if (!message) throw new McpError("protocol", false, "xTiles sent a reply we could not read.");
    if (message.error) {
      throw new McpError("protocol", false, `xTiles reported an error (code ${message.error.code ?? "?"}).`);
    }
    return message.result ?? null;
  }

  private async notify(method: string): Promise<void> {
    const response = await this.post({ jsonrpc: "2.0", method });
    await response.text().catch(() => "");
  }

  async listTools(): Promise<readonly ToolInfo[]> {
    if (this.tools) return this.tools;
    const collected: ToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const result = (await this.request("tools/list", cursor ? { cursor } : {})) as {
        tools?: ToolInfo[];
        nextCursor?: string;
      } | null;
      collected.push(...(result?.tools ?? []));
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    this.tools = collected;
    return collected;
  }

  /** The named tools, or a protocol error naming the ones that are missing. */
  async requireTools(names: readonly string[]): Promise<Map<string, ToolInfo>> {
    const available = new Map((await this.listTools()).map((tool) => [tool.name, tool]));
    const missing = names.filter((name) => !available.has(name));
    if (missing.length > 0) {
      throw new McpError("protocol", false, `xTiles does not offer the tool(s): ${missing.join(", ")}.`);
    }
    return available;
  }

  /** Call a tool and return its text. A tool-level failure throws. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: { type?: string; text?: string }[];
      structuredContent?: unknown;
      isError?: boolean;
    } | null;

    const text = (result?.content ?? [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("\n");

    if (result?.isError) {
      // The tool's own message is about xTiles' objects, not about us, but it is
      // still kept short and is never logged by the caller.
      throw new McpError("tool", false, `A tool reported a failure (${name}): ${text.slice(0, 160)}`);
    }
    if (text.length === 0 && result?.structuredContent !== undefined) {
      return JSON.stringify(result.structuredContent);
    }
    return text;
  }

  /** Politely end the session. Best effort: nothing depends on it. */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await fetch(mcpUrl(), {
        method: "DELETE",
        headers: this.headers(),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Sessions expire on their own.
    }
  }
}
