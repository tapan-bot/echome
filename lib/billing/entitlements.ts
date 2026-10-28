import "server-only";

import { LOCAL_MODE } from "@/lib/local/mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { decideAccess, type Access } from "@/lib/billing/access";
import type { Tier } from "@/lib/config/pricing";

/**
 * What someone is entitled to.
 *
 * The only writer is the Stripe webhook. Nothing in the request path can grant
 * an entitlement — checkout completing in the browser is not proof of payment,
 * a signed webhook is.
 */

export type EntitlementStatus = "inactive" | "active" | "past_due" | "canceled";

export interface Entitlement {
  readonly tier: Tier | "none";
  readonly status: EntitlementStatus;
  readonly currentPeriodEnd: Date | null;
  readonly stripeCustomerId: string | null;
}

const NONE: Entitlement = {
  tier: "none",
  status: "inactive",
  currentPeriodEnd: null,
  stripeCustomerId: null,
};

export async function entitlementFor(userId: string): Promise<Entitlement> {
  // Local mode has no Stripe. Everything is unlocked so the app is testable;
  // this is one more reason local mode must never reach production.
  if (LOCAL_MODE) {
    return { tier: "founders", status: "active", currentPeriodEnd: null, stripeCustomerId: null };
  }

  const { data, error } = await createAdminClient()
    .from("entitlements")
    .select("tier, status, current_period_end, stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle<{
      tier: Tier | "none";
      status: EntitlementStatus;
      current_period_end: string | null;
      stripe_customer_id: string | null;
    }>();

  if (error) throw error;
  if (!data) return NONE;

  return {
    tier: data.tier,
    status: data.status,
    currentPeriodEnd: data.current_period_end ? new Date(data.current_period_end) : null,
    stripeCustomerId: data.stripe_customer_id,
  };
}

export type { Access } from "@/lib/billing/access";

/**
 * May this person hold a conversation? Reads what the rule needs, then asks it
 * (lib/billing/access.ts). Local mode has no Stripe, so everything is open.
 */
export async function accessFor(userId: string): Promise<Access> {
  const entitlement = await entitlementFor(userId);

  // Paying (local mode counts everyone as paying): nothing about the free week matters.
  if (entitlement.status === "active" || entitlement.status === "past_due") {
    return decideAccess({ entitlement, trialStartedAt: null, now: new Date() });
  }

  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("free_week_started_at")
    .eq("id", userId)
    .maybeSingle<{ free_week_started_at: string | null }>();

  // If the free week cannot be read (the column is not there yet, the database is down), a
  // person who has not paid is let in rather than locked out: the product is the conversation,
  // and a fault of ours must not close it. It is logged by class only.
  if (error) {
    console.warn(`[billing] free week unreadable — ${error.code ?? "error"}`);
    return decideAccess({ entitlement, trialStartedAt: null, now: new Date() });
  }

  return decideAccess({
    entitlement,
    trialStartedAt: data?.free_week_started_at ? new Date(data.free_week_started_at) : null,
    now: new Date(),
  });
}

/**
 * Called on a person's first message: their free week begins. Once per account, forever: the
 * update only touches a profile whose week has not begun, so it can never be restarted.
 */
export async function startFreeWeek(userId: string): Promise<void> {
  if (LOCAL_MODE) return;
  const { error } = await createAdminClient()
    .from("profiles")
    .update({ free_week_started_at: new Date().toISOString() })
    .eq("id", userId)
    .is("free_week_started_at", null);
  if (error) throw error;
}

export async function grantEntitlement(params: {
  userId: string;
  tier: Tier;
  status: EntitlementStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
}): Promise<void> {
  const { error } = await createAdminClient()
    .from("entitlements")
    .upsert(
      {
        user_id: params.userId,
        tier: params.tier,
        status: params.status,
        stripe_customer_id: params.stripeCustomerId,
        stripe_subscription_id: params.stripeSubscriptionId,
        current_period_end: params.currentPeriodEnd?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) throw error;
}

export async function setEntitlementStatus(
  stripeCustomerId: string,
  status: EntitlementStatus,
  currentPeriodEnd: Date | null,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("entitlements")
    .update({
      status,
      current_period_end: currentPeriodEnd?.toISOString() ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_customer_id", stripeCustomerId);
  if (error) throw error;
}
