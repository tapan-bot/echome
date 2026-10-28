import { FREE_TRIAL_DAYS } from "@/lib/config/pricing";

/**
 * May this person hold a conversation? The rule itself, with nothing to fetch: given
 * what someone has paid for and when their free week began, and the time, the answer.
 * Kept apart from the database code so it can be tested on its own.
 *
 * Ways in: a paid plan, a plan whose card is being retried, or the free week. The free
 * week begins with a person's first message and lasts FREE_TRIAL_DAYS days, across as
 * many conversations as they like. A conversation left open when the week ends can
 * still be finished and kept: only starting or continuing to talk needs a plan.
 */
export interface Access {
  readonly allowed: boolean;
  readonly reason: "paid" | "free-trial" | "needs-purchase" | "lapsed";
  /** When their free week began. Null until their first message. */
  readonly trialStartedAt: Date | null;
  /** When it ends (or ended). Null until it has begun. */
  readonly trialEndsAt: Date | null;
}

export interface AccessInput {
  readonly entitlement: {
    readonly tier: "none" | "access" | "founders";
    readonly status: "inactive" | "active" | "past_due" | "canceled";
  };
  /** When the free week began, or null if it has not. */
  readonly trialStartedAt: Date | null;
  readonly now: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function decideAccess({ entitlement, trialStartedAt, now }: AccessInput): Access {
  const base = { trialStartedAt: null, trialEndsAt: null } as const;

  if (entitlement.status === "active") return { allowed: true, reason: "paid", ...base };
  if (entitlement.status === "past_due") {
    // A failed card should not lock someone out of a conversation mid-thought.
    // Stripe retries for days; we keep them in until it gives up.
    return { allowed: true, reason: "paid", ...base };
  }
  if (entitlement.tier !== "none" && entitlement.status === "canceled") {
    return { allowed: false, reason: "lapsed", ...base };
  }

  // Not begun: the week starts with their first message, so until then it is all still ahead.
  if (trialStartedAt === null) return { allowed: true, reason: "free-trial", ...base };

  const trialEndsAt = new Date(trialStartedAt.getTime() + FREE_TRIAL_DAYS * DAY_MS);
  return now.getTime() < trialEndsAt.getTime()
    ? { allowed: true, reason: "free-trial", trialStartedAt, trialEndsAt }
    : { allowed: false, reason: "needs-purchase", trialStartedAt, trialEndsAt };
}

/** Whole days left in the free week, rounded up, never below zero. */
export function trialDaysLeft(access: Access, now: Date): number | null {
  if (access.reason !== "free-trial" || access.trialEndsAt === null) return null;
  return Math.max(0, Math.ceil((access.trialEndsAt.getTime() - now.getTime()) / DAY_MS));
}
