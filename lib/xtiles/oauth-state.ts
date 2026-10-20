import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  decryptTranscript,
  encryptTranscript,
  generateSessionKey,
  unwrapSessionKey,
  wrapSessionKey,
} from "@/lib/echo/crypto";

/**
 * What has to survive the trip to xTiles' sign-in page and back: the one-time
 * PKCE secret, the state value that proves the return is ours, and the client id
 * we registered. It rides in a short-lived cookie, sealed with the same envelope
 * as everything else, so the browser carries it but cannot read or alter it.
 *
 * Bound to the signed-in person: a sealed cookie from one account does not open
 * for another.
 */

export const OAUTH_COOKIE = "echome_xtiles_oauth";
/** Ten minutes is plenty to sign in; a stale link should not still work. */
export const OAUTH_COOKIE_MAX_AGE_SECONDS = 600;

export interface OAuthState {
  readonly state: string;
  readonly verifier: string;
  readonly clientId: string;
  readonly redirectUri: string;
  /** Expiry, in ms since the epoch. */
  readonly exp: number;
}

function aad(userId: string): Buffer {
  return Buffer.from(`echome:xtiles:oauth:v1:${userId}`, "utf8");
}

export function sealOAuthState(userId: string, payload: OAuthState): string {
  const dataKey = generateSessionKey();
  const { nonce, ciphertext } = encryptTranscript(JSON.stringify(payload), dataKey, aad(userId));
  return [wrapSessionKey(dataKey), nonce, ciphertext].map((part) => part.toString("base64url")).join(".");
}

/** The state, or null for anything wrong: tampered, expired, someone else's. */
export function openOAuthState(
  userId: string,
  sealed: string | undefined,
  now: number = Date.now(),
): OAuthState | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;
  try {
    const [wrapped, nonce, ciphertext] = parts.map((part) => Buffer.from(part, "base64url")) as [
      Buffer,
      Buffer,
      Buffer,
    ];
    const dataKey = unwrapSessionKey(wrapped);
    const parsed = JSON.parse(decryptTranscript(ciphertext, nonce, dataKey, aad(userId))) as OAuthState;
    if (
      typeof parsed.state !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.clientId !== "string" ||
      typeof parsed.redirectUri !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp < now
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Constant-time, so how long the comparison takes says nothing about the value. */
export function statesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
