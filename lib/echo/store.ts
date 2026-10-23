/**
 * Storage seam for live sessions.
 *
 * Every persistence detail lives behind this interface so that the session
 * lifecycle — including key destruction — can be tested without a database, and
 * so that Phase 2's xTiles adapter has a pattern to follow.
 *
 * Note what the interface does NOT offer: there is no way to read a payload
 * without also reading the wrapped key, and no way to update a payload without
 * supplying a user id. Both are deliberate.
 */

export type SessionStatus = "open" | "closing" | "closed";

export interface SessionRow {
  readonly id: string;
  readonly userId: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly encryptedPayload: Buffer;
  readonly wrappedKey: Buffer;
  readonly nonce: Buffer;
}

export interface NewSession {
  readonly id: string;
  readonly userId: string;
  readonly encryptedPayload: Buffer;
  readonly wrappedKey: Buffer;
  readonly nonce: Buffer;
}

export interface PayloadUpdate {
  readonly encryptedPayload: Buffer;
  readonly nonce: Buffer;
}

export interface SessionStore {
  findOpen(userId: string): Promise<SessionRow | null>;
  /** The session part-way through the closing ritual, if there is one. */
  findClosing(userId: string): Promise<SessionRow | null>;
  find(sessionId: string, userId: string): Promise<SessionRow | null>;
  create(session: NewSession): Promise<SessionRow>;
  /** Replaces the payload and bumps last_active_at. */
  savePayload(sessionId: string, userId: string, update: PayloadUpdate): Promise<void>;
  setStatus(sessionId: string, userId: string, status: SessionStatus): Promise<void>;
  /**
   * Overwrite the wrapped key in place. The caller supplies the bytes so the
   * destruction pattern stays in one place (crypto.destroyedKeyBytes).
   */
  overwriteWrappedKey(sessionId: string, userId: string, bytes: Buffer): Promise<void>;
  remove(sessionId: string, userId: string): Promise<void>;
}

export class SessionConflictError extends Error {
  override readonly name = "SessionConflictError";
  constructor() {
    super("This user already has an open session.");
  }
}

/**
 * In-memory implementation, used by the test suite. Holds exactly what Postgres
 * holds — ciphertext and wrapped keys — so a test that proves destruction here
 * proves it for the real store too.
 */
export class InMemorySessionStore implements SessionStore {
  private rows = new Map<string, SessionRow>();

  async findOpen(userId: string): Promise<SessionRow | null> {
    for (const row of this.rows.values()) {
      if (row.userId === userId && row.status === "open") return row;
    }
    return null;
  }

  /** The most recently active closing row, as the Postgres store returns. */
  async findClosing(userId: string): Promise<SessionRow | null> {
    let latest: SessionRow | null = null;
    for (const row of this.rows.values()) {
      if (row.userId !== userId || row.status !== "closing") continue;
      if (latest === null || row.lastActiveAt >= latest.lastActiveAt) latest = row;
    }
    return latest;
  }

  async find(sessionId: string, userId: string): Promise<SessionRow | null> {
    const row = this.rows.get(sessionId);
    return row && row.userId === userId ? row : null;
  }

  async create(session: NewSession): Promise<SessionRow> {
    if (await this.findOpen(session.userId)) throw new SessionConflictError();
    const now = new Date().toISOString();
    const row: SessionRow = {
      id: session.id,
      userId: session.userId,
      status: "open",
      createdAt: now,
      lastActiveAt: now,
      encryptedPayload: session.encryptedPayload,
      wrappedKey: session.wrappedKey,
      nonce: session.nonce,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async savePayload(sessionId: string, userId: string, update: PayloadUpdate): Promise<void> {
    const row = await this.requireRow(sessionId, userId);
    this.rows.set(sessionId, {
      ...row,
      encryptedPayload: update.encryptedPayload,
      nonce: update.nonce,
      lastActiveAt: new Date().toISOString(),
    });
  }

  async setStatus(sessionId: string, userId: string, status: SessionStatus): Promise<void> {
    const row = await this.requireRow(sessionId, userId);
    this.rows.set(sessionId, { ...row, status });
  }

  async overwriteWrappedKey(sessionId: string, userId: string, bytes: Buffer): Promise<void> {
    const row = await this.requireRow(sessionId, userId);
    this.rows.set(sessionId, { ...row, wrappedKey: bytes });
  }

  async remove(sessionId: string, userId: string): Promise<void> {
    const row = await this.find(sessionId, userId);
    if (row) this.rows.delete(sessionId);
  }

  /**
   * Test-only. Reads a row without the user check, so a test can inspect what
   * survived a destruction. Not part of SessionStore.
   */
  peek(sessionId: string): SessionRow | undefined {
    return this.rows.get(sessionId);
  }

  private async requireRow(sessionId: string, userId: string): Promise<SessionRow> {
    const row = await this.find(sessionId, userId);
    if (!row) throw new Error(`No session ${sessionId} for this user.`);
    return row;
  }
}
