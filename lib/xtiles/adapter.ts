import "server-only";

import type { MapPage } from "@/lib/echo/schema";

/**
 * The xTiles seam.
 *
 * From the build brief: "Put every xTiles call behind one adapter interface
 * with a local fake implementation, so the app is testable and so we can swap
 * the transport if the API turns out to work differently than documented."
 *
 * That last clause is doing real work. We have no xTiles API documentation, so
 * the HTTP implementation below is a shell that refuses rather than a guess
 * that half-works. The interface, the fake, the retry semantics and everything
 * that depends on them are complete and tested. Wiring the real transport is
 * one file.
 */

export interface XTilesIdentity {
  readonly workspaceId: string;
  readonly displayName: string | null;
}

export interface WriteResult {
  /** Where it landed, so a person can find it and we can retry idempotently. */
  readonly ref: string;
  readonly writtenAt: string;
}

export interface XTilesAdapter {
  /** Whether this user has a usable connection right now. */
  isConnected(userId: string): Promise<boolean>;

  identity(userId: string): Promise<XTilesIdentity | null>;

  /** The EchoMap pages already in their workspace, oldest first. */
  readExisting(userId: string): Promise<readonly MapPage[]>;

  /**
   * What the person keeps in their own xTiles, as text for Claude to read at the
   * start of a conversation: their EchoCompass (written by them) and their
   * EchoMap (the trail of past conversations). Null when there is nothing to
   * read. This is the person's own data, handed back to a conversation that is
   * theirs; it is never logged and never stored anywhere but the encrypted
   * session.
   */
  readMemory(userId: string): Promise<string | null>;

  /**
   * Whether their workspace is ready for EchoMe: connected AND the EchoHub
   * project (from the template) can be found. "no-hub" means signed in to
   * xTiles but the template has not been added yet.
   */
  checkWorkspace(userId: string): Promise<"ready" | "no-hub">;

  /**
   * Create the EchoHub (the EchoCompass and EchoMap pages) in their workspace,
   * from the template. A no-op, answering "exists", if they already have one.
   */
  createHub(userId: string): Promise<"created" | "exists">;

  /**
   * Add one dated entry to the person's EchoMap, as a page (never a task).
   *
   * The EchoCompass is theirs alone: nothing in this interface writes to it.
   *
   * MUST be idempotent on `idempotencyKey`. The closing ritual retries, and a
   * retry that duplicates an entry on someone's Map is a bug they will see forever.
   */
  write(userId: string, page: MapPage, idempotencyKey: string): Promise<WriteResult>;
}

/** Raised when the write did not happen. The session must survive this. */
export class XTilesWriteError extends Error {
  override readonly name = "XTilesWriteError";
  constructor(
    readonly reason: string,
    /** Whether trying again might work. A 401 is not worth retrying. */
    readonly retryable: boolean,
  ) {
    super(`xTiles write failed: ${reason}`);
  }
}

export class XTilesNotConnectedError extends Error {
  override readonly name = "XTilesNotConnectedError";
  constructor() {
    super("This account is not connected to an xTiles workspace.");
  }
}
