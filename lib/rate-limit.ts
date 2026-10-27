import "server-only";

import { createHash } from "node:crypto";

import { LOCAL_MODE } from "@/lib/local/mode";
import { classifyError } from "@/lib/echo/telemetry";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limiting for the auth and chat endpoints.
 *
 * The counter lives in Postgres and is incremented by a database function, not
 * by a read-then-write in application code. Two tabs sending at once would each
 * read the same count and each decide they were under the limit.
 *
 * Keys derived from an IP address are hashed, so this table cannot be used to
 * reconstruct who visited when. That matters more than usual for an app people
 * use to think about private things.
 */

export interface Limit {
  readonly max: number;
  readonly windowSeconds: number;
}

export const LIMITS = {
  /** Generous: a person in full flow types fast, and this is a conversation. */
  chat: { max: 30, windowSeconds: 60 },
  /** Tight: this is the credential-stuffing surface. */
  auth: { max: 10, windowSeconds: 300 },
  /** Distillation is expensive, and nobody closes twice in a minute. */
  ritual: { max: 6, windowSeconds: 300 },
  /** Tidying dictation is a small, cheap call a person makes now and then. */
  tidy: { max: 20, windowSeconds: 60 },
  /** Setting up the EchoHub: a button press, not something to repeat in a loop. */
  hub: { max: 10, windowSeconds: 60 },
} as const satisfies Record<string, Limit>;

export type LimitName = keyof typeof LIMITS;

export interface Verdict {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

const ALLOWED: Verdict = { allowed: true, retryAfterSeconds: 0 };

/** Hashed, so the table never holds a raw address. */
export function ipKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const address = forwarded.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`echome:ip:${address}`).digest("hex").slice(0, 32);
}

function windowStart(windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(Date.now() / ms) * ms);
}

/**
 * Consume one unit from a bucket.
 *
 * Fails OPEN. If the limiter itself is broken, people keep talking — an outage
 * in a protective mechanism should not become an outage in the product.
 */
export async function consume(name: LimitName, subject: string): Promise<Verdict> {
  if (LOCAL_MODE) return ALLOWED;

  const limit = LIMITS[name];
  const start = windowStart(limit.windowSeconds);

  try {
    const { data, error } = await createAdminClient().rpc("bump_rate_limit", {
      bucket_key: `${name}:${subject}`,
      window_start_at: start.toISOString(),
    });
    if (error) throw error;

    const count = typeof data === "number" ? data : 0;
    if (count <= limit.max) return ALLOWED;

    const elapsed = (Date.now() - start.getTime()) / 1000;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil(limit.windowSeconds - elapsed)),
    };
  } catch (error) {
    console.warn(`[rate-limit] ${name} check failed open: ${classifyError(error)}`);
    return ALLOWED;
  }
}
