import "server-only";

import {
  decryptTranscript,
  encryptTranscript,
  generateSessionKey,
  unwrapSessionKey,
  wrapSessionKey,
} from "@/lib/echo/crypto";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * xTiles OAuth tokens, encrypted at rest with the same envelope as session
 * payloads: a random data key per connection, wrapped under SESSION_MASTER_KEY.
 *
 * The reason to reuse the envelope rather than reach for something simpler is
 * that these tokens grant write access to a person's own workspace. A leaked
 * database should not hand anyone that.
 *
 * Also kept inside the encrypted blob: the client id xTiles issued when EchoMe
 * registered for this person's sign-in (needed to refresh), and the id of their
 * EchoHub project once found. Neither is a secret, but there is no reason for
 * either to sit in the clear.
 */

export interface XTilesTokens {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date | null;
  readonly workspaceId: string | null;
  /** The OAuth client registered for this person's sign-in. */
  readonly clientId: string;
  /** Their EchoHub project, once found. */
  readonly projectId: string | null;
  /**
   * When EchoMe made that project (epoch ms), if it did. A project made a moment ago may not
   * be in xTiles' project list yet, so for a little while it is trusted without the list.
   */
  readonly projectMadeAt?: number | null;
}

const TABLE = "xtiles_connections";

function toBytea(buffer: Buffer): string {
  return `\\x${buffer.toString("hex")}`;
}

function fromBytea(value: unknown): Buffer {
  if (typeof value !== "string" || !value.startsWith("\\x")) {
    throw new Error("Expected a bytea hex string from Postgres.");
  }
  return Buffer.from(value.slice(2), "hex");
}

/** Binds the ciphertext to the row, as with sessions. */
function aad(userId: string): Buffer {
  return Buffer.from(`echome:xtiles:v1:${userId}`, "utf8");
}

export async function saveTokens(userId: string, tokens: XTilesTokens): Promise<void> {
  const dataKey = generateSessionKey();
  const { nonce, ciphertext } = encryptTranscript(
    JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      clientId: tokens.clientId,
      projectId: tokens.projectId,
      projectMadeAt: tokens.projectMadeAt ?? null,
    }),
    dataKey,
    aad(userId),
  );

  const { error } = await createAdminClient()
    .from(TABLE)
    .upsert(
      {
        user_id: userId,
        workspace_id: tokens.workspaceId,
        encrypted_tokens: toBytea(ciphertext),
        wrapped_key: toBytea(wrapSessionKey(dataKey)),
        nonce: toBytea(nonce),
        expires_at: tokens.expiresAt?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

export async function readTokens(userId: string): Promise<XTilesTokens | null> {
  const { data, error } = await createAdminClient()
    .from(TABLE)
    .select("workspace_id, encrypted_tokens, wrapped_key, nonce, expires_at")
    .eq("user_id", userId)
    .maybeSingle<{
      workspace_id: string | null;
      encrypted_tokens: string;
      wrapped_key: string;
      nonce: string;
      expires_at: string | null;
    }>();

  if (error) throw error;
  if (!data) return null;

  const dataKey = unwrapSessionKey(fromBytea(data.wrapped_key));
  const plaintext = decryptTranscript(
    fromBytea(data.encrypted_tokens),
    fromBytea(data.nonce),
    dataKey,
    aad(userId),
  );
  const parsed = JSON.parse(plaintext) as {
    accessToken: string;
    refreshToken: string | null;
    clientId?: string;
    projectId?: string | null;
    projectMadeAt?: number | null;
  };

  return {
    accessToken: parsed.accessToken,
    refreshToken: parsed.refreshToken,
    expiresAt: data.expires_at ? new Date(data.expires_at) : null,
    workspaceId: data.workspace_id,
    clientId: parsed.clientId ?? "",
    projectId: parsed.projectId ?? null,
    projectMadeAt: parsed.projectMadeAt ?? null,
  };
}

export async function forgetTokens(userId: string): Promise<void> {
  const { error } = await createAdminClient().from(TABLE).delete().eq("user_id", userId);
  if (error) throw error;
}
