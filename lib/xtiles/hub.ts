import { McpError, type ToolInfo } from "@/lib/xtiles/mcp";
import type { MapPage } from "@/lib/echo/schema";
import { stripCompassTemplate, stripMapTemplate } from "@/lib/xtiles/template";

/**
 * Making sense of xTiles' tool inputs and outputs.
 *
 * xTiles documents the NAMES of its tools but not their exact inputs or the
 * shape of what they return. Rather than hard-code guesses that fail silently,
 * this module reads each tool's declared input schema to find the right
 * argument names, and reads results in whichever of the plausible shapes
 * arrives (JSON, or markdown). When it cannot make sense of something it says
 * what it could not find, by NAME, and never quotes the content.
 *
 * Everything here is pure: text in, structure out. No network, no storage.
 */

// ---------------------------------------------------------------------------
// The tools we use, by the names xTiles documents.
// ---------------------------------------------------------------------------

export const TOOL_LIST_PROJECTS = "xtiles_list_projects";
export const TOOL_GET_PROJECT = "xtiles_get_project_content";
export const TOOL_ADD_TILES = "xtiles_create_tiles_from_markdown_by_view";
/** `#` is the project title, each `##` a page, each `###` a tile (from xTiles' own tool notes). */
export const TOOL_CREATE_PROJECT = "xtiles_create_project_from_markdown";
/** Every page of a project with its id: the reliable way to find a page's id. */
export const TOOL_STRUCTURE = "xtiles_get_project_structure";

/** The project the template creates, and the pages inside it. */
export const HUB_NAME = "EchoHub";
export const COMPASS_NAME = "EchoCompass";
export const MAP_NAME = "EchoMap";

// ---------------------------------------------------------------------------
// Tool arguments, filled in from the tool's own schema.
// ---------------------------------------------------------------------------

export interface Intent {
  readonly projectId?: string;
  /** A page. xTiles calls pages "views" in places. */
  readonly viewId?: string;
  readonly markdown?: string;
  readonly cursor?: string;
}

type IntentKey = keyof Intent;

const CONVENTIONAL_NAMES: Record<IntentKey, string> = {
  projectId: "projectId",
  viewId: "viewId",
  markdown: "markdown",
  cursor: "cursor",
};

/** Which of our intents an input name is asking for, if any. */
function classify(property: string): IntentKey | null {
  const name = property.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (name.includes("cursor") || name === "pagetoken" || name === "nextpagetoken") return "cursor";
  if (name.includes("project") && name.includes("id")) return "projectId";
  if ((name.includes("view") || name.includes("page")) && name.includes("id")) return "viewId";
  if (name.includes("markdown") || ["content", "text", "body", "md"].includes(name)) return "markdown";
  return null;
}

/**
 * The arguments for a tool call, named the way the tool declares them. If the
 * tool declares no schema we fall back to the conventional names. If it
 * declares a REQUIRED input we cannot fill, that is a protocol error naming the
 * input, so the mismatch is obvious instead of a mysterious empty result.
 */
export function buildArguments(tool: ToolInfo, intent: Intent): Record<string, string> {
  const properties = Object.keys(tool.inputSchema?.properties ?? {});
  const args: Record<string, string> = {};

  if (properties.length === 0) {
    for (const key of Object.keys(intent) as IntentKey[]) {
      const value = intent[key];
      if (value !== undefined) args[CONVENTIONAL_NAMES[key]] = value;
    }
    return args;
  }

  for (const property of properties) {
    const key = classify(property);
    if (key === null) continue;
    const value = intent[key];
    if (value !== undefined) args[property] = value;
  }

  const unfilled = (tool.inputSchema?.required ?? []).filter((property) => !(property in args));
  if (unfilled.length > 0) {
    throw new McpError(
      "protocol",
      false,
      `The tool ${tool.name} needs input(s) we do not know how to fill: ${unfilled.join(", ")}.`,
    );
  }
  return args;
}

// ---------------------------------------------------------------------------
// Reading results.
// ---------------------------------------------------------------------------

function tryJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function firstString(object: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

const ID_KEYS = ["id", "viewId", "pageId", "projectId", "uuid"] as const;
const NAME_KEYS = ["name", "title"] as const;
const SKIP_IN_TEXT = new Set<string>([...ID_KEYS, "createdAt", "updatedAt", "cursor", "nextCursor"]);

export interface Named {
  readonly id: string;
  readonly name: string;
  readonly node: Record<string, unknown>;
}

/** Every object anywhere in the value that has both an id and a name. */
export function collectNamed(value: unknown, found: Named[] = [], depth = 0): Named[] {
  if (depth > 8) return found;
  if (Array.isArray(value)) {
    for (const item of value) collectNamed(item, found, depth + 1);
    return found;
  }
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const id = firstString(object, ID_KEYS);
    const name = firstString(object, NAME_KEYS);
    if (id && name) found.push({ id, name, node: object });
    for (const child of Object.values(object)) collectNamed(child, found, depth + 1);
  }
  return found;
}

/** All the text inside a value, ids and bookkeeping left out. */
export function allText(value: unknown, depth = 0): string {
  if (depth > 10) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => allText(item, depth + 1)).filter(Boolean).join("\n");
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SKIP_IN_TEXT.has(key))
      .map(([, child]) => allText(child, depth + 1))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** A name with everything but letters and digits removed, so "🧭 EchoHub™" reads as "echohub". */
const keyOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The item whose name is `target`, ignoring case, emoji and punctuation
 * ("🧭 EchoHub™" is EchoHub). With `allowPartial`, failing an exact match, the
 * shortest name that CONTAINS it ("My EchoMap"). Pages inside the hub can be
 * decorated that way; the hub itself cannot: "EchoHub Archive" must never be
 * mistaken for the real thing, because the wrong project gets written to.
 */
function bestByName<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  target: string,
  allowPartial: boolean,
): T | null {
  const wanted = keyOf(target);
  const exact = items.find((item) => keyOf(nameOf(item)) === wanted);
  if (exact !== undefined) return exact;
  if (!allowPartial) return null;
  const partial = items
    .filter((item) => keyOf(nameOf(item)).includes(wanted))
    .sort((a, b) => nameOf(a).length - nameOf(b).length);
  return partial[0] ?? null;
}

/** A heading's name without markdown decoration or an id printed beside it. */
function headingName(text: string): string {
  return text
    .replace(/[`*_]/g, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .replace(/\s*[—–-]?\s*\b(?:id|viewId|pageId)\s*[:=].*$/i, "")
    .trim();
}

export interface Project {
  readonly id: string;
  readonly name: string;
}

/** The person's projects, from a JSON list or from lines of text. */
export function parseProjects(text: string): Project[] {
  const json = tryJson(text);
  if (json !== undefined) {
    const seen = new Set<string>();
    return collectNamed(json)
      .filter((entry) => !seen.has(entry.id) && seen.add(entry.id))
      .map(({ id, name }) => ({ id, name }));
  }

  // "- EchoHub (id: abc123)", "EchoHub — abc123", "[EchoHub](https://…/abc123)".
  const projects: Project[] = [];
  for (const line of text.split(/\r?\n/)) {
    const id =
      /\b(?:id|projectId)\s*[:=]\s*`?([A-Za-z0-9_-]{6,})`?/i.exec(line)?.[1] ??
      /\(([0-9a-f]{8}-[0-9a-f-]{20,})\)/i.exec(line)?.[1] ??
      /\/([A-Za-z0-9_-]{8,})\)?\s*$/.exec(line)?.[1];
    if (!id) continue;
    const name = line
      .replace(/^[\s>*\-•\d.)]+/, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\([^)]*\)/g, "")
      .replace(/\b(?:id|projectId)\s*[:=].*$/i, "")
      .replace(/[—–-]\s*[A-Za-z0-9_-]{6,}\s*$/, "")
      .replace(/[`*_]/g, "")
      .trim();
    if (name) projects.push({ id, name });
  }
  return projects;
}

/**
 * Their EchoHub: the project named exactly that. Other projects can start with
 * "Echo" (an "EchoMe" business project, for one), so a partial match is never
 * enough on its own.
 */
export function pickHub(projects: readonly Project[]): Project | null {
  return bestByName(projects, (project) => project.name, HUB_NAME, false);
}

/** Whether the project list says there is more of it to fetch, and where from. */
export function listCursor(text: string): string | null {
  const json = tryJson(text);
  return json === undefined ? null : findCursor(json);
}

/** The id of the page called `pageName`, from a list of a project's pages. */
export function idForPage(pages: readonly Project[], pageName: string): string | null {
  return bestByName(pages, (page) => page.name, pageName, true)?.id ?? null;
}

export interface HubPage {
  /** The page's id, when the response gave one. Needed to write to it. */
  readonly id: string | null;
  readonly text: string;
}

export interface HubContent {
  readonly compass: HubPage | null;
  readonly map: HubPage | null;
  /** More of the project is available through this cursor. */
  readonly cursor: string | null;
}

function findCursor(json: unknown): string | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const object = json as Record<string, unknown>;
  const direct = firstString(object, ["nextCursor", "next_cursor", "cursor", "nextPageToken"]);
  if (direct) return direct;
  const meta = object.meta ?? object.pagination;
  if (meta !== null && typeof meta === "object") {
    return firstString(meta as Record<string, unknown>, ["nextCursor", "next_cursor", "cursor"]);
  }
  return null;
}

function pageFromMarkdown(text: string, pageName: string): HubPage | null {
  const lines = text.split(/\r?\n/);
  const heading = /^(#{1,6})\s*(.*?)\s*#*\s*$/;
  const headings = lines.flatMap((line, index) => {
    const match = heading.exec(line);
    return match === null ? [] : [{ index, name: headingName(match[2]!) }];
  });
  const found = bestByName(headings, (candidate) => candidate.name, pageName, true);
  if (found === null) return null;
  const start = found.index;

  const level = heading.exec(lines[start]!)![1]!.length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const match = heading.exec(lines[i]!);
    if (match !== null && match[1]!.length <= level) {
      end = i;
      break;
    }
  }

  // An id, if one is printed on or just under the heading.
  const near = lines.slice(start, start + 3).join(" ");
  const id =
    /\b(?:id|viewId|pageId)\s*[:=]\s*`?([A-Za-z0-9_-]{6,})`?/i.exec(near)?.[1] ??
    /\(([0-9a-f]{8}-[0-9a-f-]{20,})\)/i.exec(near)?.[1] ??
    null;

  return { id, text: lines.slice(start + 1, end).join("\n").trim() };
}

/** Find the EchoCompass and EchoMap pages in a project's content. */
export function parseHubContent(text: string): HubContent {
  const json = tryJson(text);
  if (json !== undefined) {
    const named = collectNamed(json);
    const pageFor = (pageName: string): HubPage | null => {
      const entry = bestByName(named, (candidate) => candidate.name, pageName, true);
      if (!entry) return null;
      return { id: entry.id, text: allText({ ...entry.node, name: undefined, title: undefined }).trim() };
    };
    return { compass: pageFor(COMPASS_NAME), map: pageFor(MAP_NAME), cursor: findCursor(json) };
  }
  return {
    compass: pageFromMarkdown(text, COMPASS_NAME),
    map: pageFromMarkdown(text, MAP_NAME),
    cursor: null,
  };
}

/**
 * The ids xTiles gives back after creating a project: `project_id` and
 * `view_id` (as JSON, or written out in text). Null for any it does not name.
 */
export function parseCreated(text: string): { projectId: string | null; viewId: string | null } {
  const json = tryJson(text);
  const pick = (names: readonly string[]): string | null => {
    const search = (value: unknown, depth: number): string | null => {
      if (depth > 6 || value === null || typeof value !== "object") return null;
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = search(item, depth + 1);
          if (found) return found;
        }
        return null;
      }
      const object = value as Record<string, unknown>;
      const direct = firstString(object, names);
      if (direct) return direct;
      for (const child of Object.values(object)) {
        const found = search(child, depth + 1);
        if (found) return found;
      }
      return null;
    };
    if (json !== undefined) return search(json, 0);
    for (const name of names) {
      const match = new RegExp(
        String.raw`\b${name}\b["'\x60*]*\s*[:=]\s*["'\x60]?([A-Za-z0-9_-]{6,})`,
        "i",
      ).exec(text);
      if (match) return match[1]!;
    }
    return null;
  };
  return {
    projectId: pick(["project_id", "projectId"]),
    viewId: pick(["view_id", "viewId"]),
  };
}

/** Pages already on the EchoMap: each "### date — title" heading starts one. */
export function parseEntries(mapText: string): MapPage[] {
  const pages: MapPage[] = [];
  const lines = mapText.split(/\r?\n/);
  let heading: string | null = null;
  let body: string[] = [];

  const flush = () => {
    if (heading !== null) {
      pages.push({ heading, markdown: [`### ${heading}`, ...body].join("\n").trim() });
    }
  };
  for (const line of lines) {
    const match = /^###\s+(.+?)\s*$/.exec(line);
    if (match) {
      flush();
      heading = match[1]!;
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  flush();
  return pages;
}

const squash = (text: string): string => text.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Is this entry already on their EchoMap? xTiles gives us no idempotency key, so
 * before any (re)write we look: the same dated heading AND the same first line
 * of content means a retry after a write that actually landed.
 */
export function alreadyThere(mapText: string, page: MapPage): boolean {
  const haystack = squash(mapText);
  const firstLine = page.markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("###"));
  return haystack.includes(squash(page.heading)) && (firstLine === undefined || haystack.includes(squash(firstLine)));
}

/**
 * Keep what is read for a conversation to a sensible size. The Compass is short
 * and always kept whole; the Map grows with every conversation, so when it is
 * long the most recent entries are kept and the oldest dropped.
 */
export function formatMemory(
  compass: string | null,
  map: string | null,
  maxMapChars = 24_000,
): string | null {
  // The template's own words (the purpose, the questions nobody has answered) are
  // not the person's, and must not reach Claude as though they were.
  const compassText = stripCompassTemplate(compass ?? "");
  let mapText = stripMapTemplate(map ?? "");
  if (compassText.length === 0 && mapText.length === 0) return null;

  if (mapText.length > maxMapChars) {
    const entries = parseEntries(mapText);
    if (entries.length > 1) {
      const kept: string[] = [];
      let size = 0;
      for (const entry of [...entries].reverse()) {
        if (size + entry.markdown.length > maxMapChars) break;
        kept.unshift(entry.markdown);
        size += entry.markdown.length;
      }
      mapText = `(Older entries are not shown.)\n\n${kept.join("\n\n")}`;
    } else {
      mapText = `(Earlier text is not shown.)\n${mapText.slice(-maxMapChars)}`;
    }
  }

  return [
    `EchoCompass (written by the person, in their own words)\n${compassText || "(empty)"}`,
    `EchoMap (the trail of their past conversations, oldest first)\n${mapText || "(no entries yet)"}`,
  ].join("\n\n");
}
