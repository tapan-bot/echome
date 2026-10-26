import "server-only";

import type { MapPage } from "@/lib/echo/schema";
import {
  alreadyThere,
  buildArguments,
  formatMemory,
  idForPage,
  parseCreated,
  parseEntries,
  parseHubContent,
  parseProjects,
  listCursor,
  pickHub,
  TOOL_ADD_TILES,
  TOOL_CREATE_PROJECT,
  TOOL_GET_PROJECT,
  TOOL_LIST_PROJECTS,
  TOOL_STRUCTURE,
  type HubContent,
  type HubPage,
  type Project,
} from "@/lib/xtiles/hub";
import { McpError, McpSession } from "@/lib/xtiles/mcp";
import { COMPASS_PAGE_TITLE, MAP_PAGE_TITLE, hubMarkdown } from "@/lib/xtiles/template";
import { refreshTokens, XTilesAuthError } from "@/lib/xtiles/oauth";
import { readTokens, saveTokens, type XTilesTokens } from "@/lib/xtiles/tokens";
import {
  XTilesNotConnectedError,
  XTilesWriteError,
  type WriteResult,
  type XTilesAdapter,
  type XTilesIdentity,
} from "@/lib/xtiles/adapter";

/**
 * The real xTiles transport, over xTiles' MCP server.
 *
 * The member signs in once (lib/xtiles/oauth.ts) and their tokens are kept
 * encrypted (lib/xtiles/tokens.ts). From then on each operation opens a short
 * MCP session, finds their EchoHub project, and either reads it or adds one
 * dated entry to their EchoMap page. EchoMe never writes to the EchoCompass: that
 * page is the person's own.
 */

/** Does this text name an EchoHub at all, however the line around it is written? */
const MENTIONS_HUB = /echo[\s_-]*hub/i;

/** The tools whose descriptions the diagnose route prints. */
const NOTED_TOOLS = new Set([
  "xtiles_create_project_from_markdown",
  "xtiles_create_view_from_markdown",
  "xtiles_create_tiles_from_markdown_by_view",
  "xtiles_get_project_structure",
  "xtiles_get_project_content",
  "xtiles_get_view_content",
  "xtiles_get_docs",
]);

/** Refresh a little early, so a token does not expire mid-operation. */
const REFRESH_MARGIN_MS = 60_000;

/** Signed in to xTiles, but there is no EchoHub project to work with yet. */
export class HubNotFoundError extends Error {
  override readonly name = "HubNotFoundError";
  /**
   * What was looked at, as counts only: no project or page names, nothing written.
   * `present` means an EchoHub IS in the workspace, though it could not be read.
   */
  constructor(
    readonly detail: string = "",
    readonly present: boolean = false,
  ) {
    super("The EchoHub project was not found in this xTiles workspace.");
  }
}

interface Hub {
  readonly projectId: string;
  readonly compass: HubPage | null;
  readonly map: HubPage | null;
}

export class XTilesHttpAdapter implements XTilesAdapter {
  async isConnected(userId: string): Promise<boolean> {
    const tokens = await readTokens(userId);
    if (!tokens) return false;
    // An expired access token is normal while a refresh token can renew it.
    return tokens.refreshToken !== null || tokens.expiresAt === null || tokens.expiresAt > new Date();
  }

  async identity(userId: string): Promise<XTilesIdentity | null> {
    const tokens = await readTokens(userId);
    if (!tokens) return null;
    return { workspaceId: tokens.projectId ?? "xtiles", displayName: null };
  }

  async checkWorkspace(userId: string): Promise<"ready" | "no-hub"> {
    try {
      await this.withSession(userId, (session, tokens) => this.loadHub(session, tokens, userId));
      return "ready";
    } catch (error) {
      if (error instanceof HubNotFoundError) {
        console.warn(`[xtiles] workspace check — ${error.detail || "EchoHub not found"}`);
        return "no-hub";
      }
      throw error;
    }
  }

  async readMemory(userId: string): Promise<string | null> {
    const hub = await this.withSession(userId, (session, tokens) => this.loadHub(session, tokens, userId));
    return formatMemory(hub.compass?.text ?? null, hub.map?.text ?? null);
  }

  async readExisting(userId: string): Promise<readonly MapPage[]> {
    const hub = await this.withSession(userId, (session, tokens) => this.loadHub(session, tokens, userId));
    return parseEntries(hub.map?.text ?? "");
  }

  async write(userId: string, page: MapPage, _idempotencyKey: string): Promise<WriteResult> {
    try {
      return await this.withSession(userId, async (session, tokens) => {
        const hub = await this.loadHub(session, tokens, userId);
        if (!hub.map?.id) {
          throw new McpError("protocol", false, "The EchoMap page was found, but its id could not be read.");
        }
        const ref = `${hub.projectId}/${hub.map.id}`;

        // xTiles offers no idempotency key, so a retry checks first: if the entry
        // already landed, the earlier attempt succeeded and this one is a no-op.
        if (alreadyThere(hub.map.text, page)) {
          return { ref, writtenAt: new Date().toISOString() };
        }

        const tools = await session.requireTools([TOOL_ADD_TILES]);
        await session.callTool(
          TOOL_ADD_TILES,
          buildArguments(tools.get(TOOL_ADD_TILES)!, { viewId: hub.map.id, markdown: page.markdown }),
        );
        return { ref, writtenAt: new Date().toISOString() };
      });
    } catch (error) {
      throw toWriteError(error);
    }
  }

  /**
   * Something to look at while this is first being connected to a real
   * workspace. It reports what the tools are and how they answer, for a signed-in
   * person looking at their own account; it is off unless XTILES_DIAGNOSE is set.
   */
  async diagnose(userId: string): Promise<Record<string, unknown>> {
    return this.withSession(userId, async (session, tokens) => {
      const tools = await session.listTools();
      const out: Record<string, unknown> = {
        tools: tools.map((tool) => ({
          name: tool.name,
          inputs: Object.keys(tool.inputSchema?.properties ?? {}),
          required: tool.inputSchema?.required ?? [],
        })),
        // xTiles' own words about how its markdown tools behave: how markdown is
        // split into pages and tiles, how a workspace is chosen. These are
        // documentation, not anyone's content. Needed to build the EchoHub setup.
        toolNotes: Object.fromEntries(
          tools
            .filter((tool) => NOTED_TOOLS.has(tool.name))
            .map((tool) => [tool.name, (tool.description ?? "").slice(0, 2500)]),
        ),
      };
      const available = await session.requireTools([TOOL_LIST_PROJECTS, TOOL_GET_PROJECT]);
      const list = await session.callTool(TOOL_LIST_PROJECTS, buildArguments(available.get(TOOL_LIST_PROJECTS)!, {}));
      out.projectsReply = list.slice(0, 3000);
      const hub = pickHub(parseProjects(list));
      out.hubFound = hub !== null;
      if (hub) {
        const content = await session.callTool(
          TOOL_GET_PROJECT,
          buildArguments(available.get(TOOL_GET_PROJECT)!, { projectId: hub.id }),
        );
        out.projectReply = content.slice(0, 4000);
        const parsed = parseHubContent(content);
        out.parsed = {
          compassFound: parsed.compass !== null,
          mapFound: parsed.map !== null,
          mapHasId: parsed.map?.id != null,
          cursor: parsed.cursor !== null,
        };
      }
      out.projectIdSaved = tokens.projectId !== null;
      return out;
    });
  }

  // -------------------------------------------------------------------------

  /** Find their EchoHub and read the pages EchoMe cares about. */
  private async loadHub(session: McpSession, tokens: XTilesTokens, userId: string): Promise<Hub> {
    const tools = await session.requireTools([TOOL_LIST_PROJECTS, TOOL_GET_PROJECT]);
    const read = async (projectId: string): Promise<HubContent> => {
      let merged: HubContent = { compass: null, map: null, cursor: null };
      let cursor: string | undefined;
      // The project can come back in pages; follow the cursor until both are found.
      for (let page = 0; page < 5; page += 1) {
        const text = await session.callTool(
          TOOL_GET_PROJECT,
          buildArguments(tools.get(TOOL_GET_PROJECT)!, { projectId, cursor }),
        );
        const next = parseHubContent(text);
        merged = {
          compass: merged.compass ?? next.compass,
          map: merged.map ?? next.map,
          cursor: next.cursor,
        };
        if ((merged.compass && merged.map) || !next.cursor) break;
        cursor = next.cursor;
      }
      return this.withPageIds(session, projectId, merged);
    };

    // The project id found last time, if any; otherwise look for it.
    if (tokens.projectId) {
      const content = await read(tokens.projectId);
      if (content.compass || content.map) return { projectId: tokens.projectId, ...content };
      // Stale (deleted or replaced): fall through and look again.
    }

    // The project list can come back in pages too; follow it until the hub shows up.
    let project: Project | null = null;
    let listed = 0;
    let mentioned = false; // the raw list names an EchoHub, whether or not we could read its line
    let cursor: string | undefined;
    for (let page = 0; page < 5 && !project; page += 1) {
      const list = await session.callTool(
        TOOL_LIST_PROJECTS,
        buildArguments(tools.get(TOOL_LIST_PROJECTS)!, { cursor }),
      );
      const projects = parseProjects(list);
      listed += projects.length;
      mentioned ||= MENTIONS_HUB.test(list);
      project = pickHub(projects);
      const next = listCursor(list);
      // A tool that ignores the cursor would hand back the same page forever.
      if (!next || next === cursor) break;
      cursor = next;
    }
    if (!project) {
      throw new HubNotFoundError(
        mentioned
          ? `an EchoHub is named in the project list, but its entry could not be read (${listed} read)`
          : `${listed} project(s) listed, none named like EchoHub`,
        mentioned,
      );
    }

    const content = await read(project.id);
    if (!content.compass && !content.map) {
      throw new HubNotFoundError("EchoHub found, but neither an EchoCompass nor an EchoMap page was in it");
    }

    if (tokens.projectId !== project.id) {
      // Remember it. Failing to is no reason to fail the operation.
      await saveTokens(userId, { ...tokens, projectId: project.id }).catch(() => undefined);
    }
    return { projectId: project.id, ...content };
  }

  /**
   * A page's id is what writing to it needs, and reading a project's content may
   * not print one. The project's structure lists every page with its id, so when
   * the content left one out, ask for it there. Anything that goes wrong here
   * leaves the content as it was: the caller decides whether a missing id matters.
   */
  private async withPageIds(session: McpSession, projectId: string, content: HubContent): Promise<HubContent> {
    const missing = (page: HubPage | null) => page !== null && page.id === null;
    if (!missing(content.compass) && !missing(content.map)) return content;
    try {
      const tools = await session.requireTools([TOOL_STRUCTURE]);
      const text = await session.callTool(TOOL_STRUCTURE, buildArguments(tools.get(TOOL_STRUCTURE)!, { projectId }));
      const pages = parseProjects(text);
      const withId = (page: HubPage | null, title: string): HubPage | null =>
        page !== null && page.id === null ? { ...page, id: idForPage(pages, title) } : page;
      return {
        ...content,
        compass: withId(content.compass, COMPASS_PAGE_TITLE),
        map: withId(content.map, MAP_PAGE_TITLE),
      };
    } catch {
      return content;
    }
  }

  /**
   * Set up the member's EchoHub in their own xTiles, from the template. Only ever
   * when there is none: if one is found, nothing is created. The project's id comes
   * straight back from xTiles, is kept, and the same code that will later read and
   * write the hub must be able to find it again before this counts as done.
   */
  async createHub(userId: string): Promise<"created" | "exists"> {
    return this.withSession(userId, async (session, tokens) => {
      try {
        await this.loadHub(session, tokens, userId);
        return "exists";
      } catch (error) {
        if (!(error instanceof HubNotFoundError)) throw error;
        // One is in the list, we just cannot read it: creating another would only
        // leave them with two.
        if (error.present) return "exists";
      }

      const tools = await session.requireTools([TOOL_CREATE_PROJECT]);

      // A hub created earlier whose content we could not read back must not be
      // created a second time: if the project we remembered still answers, leave it.
      if (tokens.projectId) {
        try {
          const structure = await session.requireTools([TOOL_STRUCTURE]);
          await session.callTool(
            TOOL_STRUCTURE,
            buildArguments(structure.get(TOOL_STRUCTURE)!, { projectId: tokens.projectId }),
          );
          return "exists";
        } catch {
          // Gone, or not readable: carry on and create it.
        }
      }

      const reply = await session.callTool(
        TOOL_CREATE_PROJECT,
        buildArguments(tools.get(TOOL_CREATE_PROJECT)!, { markdown: hubMarkdown() }),
      );
      const { projectId } = parseCreated(reply);
      if (!projectId) {
        throw new McpError("protocol", false, "The EchoHub was created, but its id could not be read.");
      }
      // Remember it before anything else can fail, so a retry finds it.
      await saveTokens(userId, { ...tokens, projectId });
      await this.loadHub(session, { ...tokens, projectId }, userId);
      return "created";
    });
  }

  /**
   * Run something against an open session, with a fresh token. If xTiles refuses
   * the token once, refresh it and try again; if that fails, the person has to
   * connect again.
   */
  private async withSession<T>(
    userId: string,
    work: (session: McpSession, tokens: XTilesTokens) => Promise<T>,
  ): Promise<T> {
    let tokens = await readTokens(userId);
    if (!tokens) throw new XTilesNotConnectedError();

    const expiring = tokens.expiresAt !== null && tokens.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS;
    if (expiring && tokens.refreshToken) tokens = await this.refresh(userId, tokens);

    for (let attempt = 0; ; attempt += 1) {
      let session: McpSession | null = null;
      try {
        session = await McpSession.open(tokens.accessToken);
        return await work(session, tokens);
      } catch (error) {
        const refusedOnce =
          error instanceof McpError && error.kind === "unauthorized" && attempt === 0 && tokens.refreshToken;
        if (!refusedOnce) throw error;
        tokens = await this.refresh(userId, tokens);
      } finally {
        await session?.close();
      }
    }
  }

  private async refresh(userId: string, tokens: XTilesTokens): Promise<XTilesTokens> {
    if (!tokens.refreshToken || !tokens.clientId) throw new XTilesNotConnectedError();
    try {
      const fresh = await refreshTokens({ refreshToken: tokens.refreshToken, clientId: tokens.clientId });
      const next: XTilesTokens = {
        ...tokens,
        accessToken: fresh.accessToken,
        // Some servers rotate the refresh token; keep the new one if given.
        refreshToken: fresh.refreshToken ?? tokens.refreshToken,
        expiresAt: fresh.expiresAt,
      };
      await saveTokens(userId, next);
      return next;
    } catch (error) {
      // A revoked or expired grant cannot be mended by retrying.
      if (error instanceof XTilesAuthError && !error.retryable) throw new XTilesNotConnectedError();
      throw error;
    }
  }
}

/** What the closing ritual needs to know: did the write fail, and is it worth retrying. */
function toWriteError(error: unknown): Error {
  if (error instanceof XTilesNotConnectedError || error instanceof XTilesWriteError) return error;
  if (error instanceof HubNotFoundError) {
    return new XTilesWriteError(`no EchoHub project${error.detail ? ` (${error.detail})` : ""}`, false);
  }
  if (error instanceof McpError) {
    // Why it failed, for the receipt and the logs. A tool's own failure text is
    // dropped (everything after the tool's name): it is xTiles' words, and could
    // echo what we sent.
    const detail = error.message.replace(/\):.*$/s, ")");
    return new XTilesWriteError(`${error.kind}: ${detail}`, error.retryable);
  }
  if (error instanceof XTilesAuthError) return new XTilesWriteError(error.code, error.retryable);
  return new XTilesWriteError("unexpected", true);
}
