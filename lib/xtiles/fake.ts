import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { MapPage } from "@/lib/echo/schema";
import { formatMemory } from "@/lib/xtiles/hub";
import {
  XTilesWriteError,
  type WriteResult,
  type XTilesAdapter,
  type XTilesIdentity,
} from "@/lib/xtiles/adapter";

/**
 * A working stand-in for xTiles, backed by a JSON file.
 *
 * This is not a mock that returns canned values — it accumulates writes, honours
 * the idempotency key, and can be told to fail, so the closing ritual's recovery
 * path is exercised against something that behaves like a real service.
 *
 * Used by the test suite, and by local mode so the whole ritual can be walked
 * through without an xTiles account.
 */

interface Workspace {
  workspaceId: string;
  displayName: string;
  /** The EchoMap, oldest first. There is no Compass: only the person writes that. */
  map: MapPage[];
  /** idempotencyKey -> ref, so a retry returns the original result. */
  writes: Record<string, { ref: string; writtenAt: string }>;
}

export class FakeXTiles implements XTilesAdapter {
  /** Set to make the next write fail, to exercise the recovery path. */
  failNextWrite: { reason: string; retryable: boolean } | null = null;

  constructor(private readonly persistTo: string | null = null) {}

  private memory = new Map<string, Workspace>();

  private path(): string {
    return join(process.cwd(), ".echome-local", "xtiles.json");
  }

  private load(): Record<string, Workspace> {
    if (!this.persistTo) return Object.fromEntries(this.memory);
    try {
      return JSON.parse(readFileSync(this.path(), "utf8")) as Record<string, Workspace>;
    } catch {
      return {};
    }
  }

  private save(all: Record<string, Workspace>): void {
    if (!this.persistTo) {
      this.memory = new Map(Object.entries(all));
      return;
    }
    mkdirSync(join(process.cwd(), ".echome-local"), { recursive: true });
    writeFileSync(this.path(), `${JSON.stringify(all, null, 2)}\n`, "utf8");
  }

  private workspaceFor(all: Record<string, Workspace>, userId: string): Workspace {
    const existing = all[userId];
    if (!existing) {
      return {
        workspaceId: `fake-ws-${userId.slice(0, 8)}`,
        displayName: "Local workspace",
        map: [],
        writes: {},
      };
    }
    // A local file written by an older version of the app may hold entries in a
    // shape that no longer exists. Keep only well-formed pages.
    return {
      ...existing,
      map: (Array.isArray(existing.map) ? existing.map : []).filter(
        (page): page is MapPage => typeof page?.markdown === "string",
      ),
    };
  }

  /** Everyone is connected in the fake — connection is tested separately. */
  async isConnected(): Promise<boolean> {
    return true;
  }

  async identity(userId: string): Promise<XTilesIdentity> {
    const workspace = this.workspaceFor(this.load(), userId);
    return { workspaceId: workspace.workspaceId, displayName: workspace.displayName };
  }

  async readExisting(userId: string): Promise<readonly MapPage[]> {
    return this.workspaceFor(this.load(), userId).map;
  }

  /**
   * The same shape the real adapter hands back, built from what this fake holds,
   * so local mode exercises the whole read-then-write loop: close a conversation
   * keeping an entry, and the next conversation starts with it in view. The
   * Compass is the person's own and the fake has no way to write one.
   */
  async readMemory(userId: string): Promise<string | null> {
    const pages = this.workspaceFor(this.load(), userId).map;
    return formatMemory(null, pages.map((page) => page.markdown).join("\n\n"));
  }

  async checkWorkspace(): Promise<"ready" | "no-hub"> {
    return "ready";
  }

  async write(userId: string, page: MapPage, idempotencyKey: string): Promise<WriteResult> {
    if (this.failNextWrite) {
      const { reason, retryable } = this.failNextWrite;
      this.failNextWrite = null;
      throw new XTilesWriteError(reason, retryable);
    }

    const all = this.load();
    const workspace = this.workspaceFor(all, userId);

    // A retry must not duplicate an entry on someone's Map.
    const existing = workspace.writes[idempotencyKey];
    if (existing) return existing;

    const result = {
      ref: `${workspace.workspaceId}/${idempotencyKey}`,
      writtenAt: new Date().toISOString(),
    };

    all[userId] = {
      ...workspace,
      map: [...workspace.map, page],
      writes: { ...workspace.writes, [idempotencyKey]: result },
    };
    this.save(all);
    return result;
  }
}
