import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  SessionConflictError,
  type NewSession,
  type PayloadUpdate,
  type SessionRow,
  type SessionStatus,
  type SessionStore,
} from "@/lib/echo/store";

/**
 * Supabase-backed SessionStore.
 *
 * live_sessions has RLS on with no policies, so this runs on the service role
 * and every single query filters on user_id explicitly. There is no method here
 * that can touch a row without being told whose it is.
 */

const TABLE = "live_sessions";

/** PostgREST represents bytea as a hex string prefixed with \x. */
function toBytea(buffer: Buffer): string {
  return `\\x${buffer.toString("hex")}`;
}

function fromBytea(value: unknown): Buffer {
  if (typeof value !== "string" || !value.startsWith("\\x")) {
    throw new Error("Expected a bytea hex string from Postgres.");
  }
  return Buffer.from(value.slice(2), "hex");
}

interface RawRow {
  id: string;
  user_id: string;
  status: SessionStatus;
  created_at: string;
  last_active_at: string;
  encrypted_payload: string;
  wrapped_key: string;
  nonce: string;
}

const COLUMNS = "id, user_id, status, created_at, last_active_at, encrypted_payload, wrapped_key, nonce";

function toRow(raw: RawRow): SessionRow {
  return {
    id: raw.id,
    userId: raw.user_id,
    status: raw.status,
    createdAt: raw.created_at,
    lastActiveAt: raw.last_active_at,
    encryptedPayload: fromBytea(raw.encrypted_payload),
    wrappedKey: fromBytea(raw.wrapped_key),
    nonce: fromBytea(raw.nonce),
  };
}

export class PostgresSessionStore implements SessionStore {
  private get db() {
    return createAdminClient();
  }

  async findOpen(userId: string): Promise<SessionRow | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select(COLUMNS)
      .eq("user_id", userId)
      .eq("status", "open")
      .maybeSingle<RawRow>();
    if (error) throw error;
    return data ? toRow(data) : null;
  }

  async findClosing(userId: string): Promise<SessionRow | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select(COLUMNS)
      .eq("user_id", userId)
      .eq("status", "closing")
      // More than one can exist: nothing in the database limits closing rows the way
      // the unique index limits open ones, and a "Go back" that raced the chat
      // page used to leave one behind each time. maybeSingle() on several rows is
      // an error, which crashed the chat. Take the most recent.
      .order("last_active_at", { ascending: false })
      .limit(1)
      .maybeSingle<RawRow>();
    if (error) throw error;
    return data ? toRow(data) : null;
  }

  async find(sessionId: string, userId: string): Promise<SessionRow | null> {
    const { data, error } = await this.db
      .from(TABLE)
      .select(COLUMNS)
      .eq("id", sessionId)
      .eq("user_id", userId)
      .maybeSingle<RawRow>();
    if (error) throw error;
    return data ? toRow(data) : null;
  }

  async create(session: NewSession): Promise<SessionRow> {
    const { data, error } = await this.db
      .from(TABLE)
      .insert({
        id: session.id,
        user_id: session.userId,
        status: "open",
        encrypted_payload: toBytea(session.encryptedPayload),
        wrapped_key: toBytea(session.wrappedKey),
        nonce: toBytea(session.nonce),
      })
      .select(COLUMNS)
      .single<RawRow>();
    // 23505 is unique_violation — the partial index enforcing one open session
    // per user. Racing tabs land here rather than creating a second session.
    if (error?.code === "23505") throw new SessionConflictError();
    if (error) throw error;
    return toRow(data);
  }

  async savePayload(sessionId: string, userId: string, update: PayloadUpdate): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .update({
        encrypted_payload: toBytea(update.encryptedPayload),
        nonce: toBytea(update.nonce),
        last_active_at: new Date().toISOString(),
      })
      .eq("id", sessionId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async setStatus(sessionId: string, userId: string, status: SessionStatus): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .update({ status })
      .eq("id", sessionId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async overwriteWrappedKey(sessionId: string, userId: string, bytes: Buffer): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .update({ wrapped_key: toBytea(bytes) })
      .eq("id", sessionId)
      .eq("user_id", userId);
    if (error) throw error;
  }

  async remove(sessionId: string, userId: string): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq("id", sessionId)
      .eq("user_id", userId);
    if (error) throw error;
  }
}
