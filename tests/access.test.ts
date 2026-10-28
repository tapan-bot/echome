import { describe, expect, it } from "vitest";

import { decideAccess, trialDaysLeft } from "@/lib/billing/access";
import { FREE_TRIAL_DAYS } from "@/lib/config/pricing";

/**
 * Who may talk. The free week is the part that changed: it begins with the first message,
 * covers as many conversations as they like, and ends a fixed time later.
 */

const NOW = new Date("2026-11-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const none = { tier: "none", status: "inactive" } as const;

describe("the free week", () => {
  it("lasts a week", () => {
    expect(FREE_TRIAL_DAYS).toBe(7);
  });

  it("has not begun until the first message, and lets them in", () => {
    const access = decideAccess({ entitlement: none, trialStartedAt: null, now: NOW });
    expect(access).toMatchObject({ allowed: true, reason: "free-trial", trialStartedAt: null, trialEndsAt: null });
  });

  it("lets them keep talking, in as many conversations as they like, until it ends", () => {
    // Day three: well inside the week. It no longer ends after one message.
    const access = decideAccess({ entitlement: none, trialStartedAt: ago(3), now: NOW });
    expect(access.allowed).toBe(true);
    expect(access.reason).toBe("free-trial");
    expect(access.trialEndsAt).toEqual(new Date(ago(3).getTime() + 7 * DAY));
  });

  it("is still open on its last day, and closed the moment the week is up", () => {
    expect(decideAccess({ entitlement: none, trialStartedAt: ago(6.9), now: NOW }).allowed).toBe(true);
    const over = decideAccess({ entitlement: none, trialStartedAt: ago(7), now: NOW });
    expect(over).toMatchObject({ allowed: false, reason: "needs-purchase" });
    expect(decideAccess({ entitlement: none, trialStartedAt: ago(30), now: NOW }).allowed).toBe(false);
  });

  it("says how many days are left, rounding up, and nothing once it is over", () => {
    const left = (days: number) =>
      trialDaysLeft(decideAccess({ entitlement: none, trialStartedAt: ago(days), now: NOW }), NOW);
    expect(left(0)).toBe(7);
    expect(left(5.5)).toBe(2);
    expect(left(6.9)).toBe(1);
    expect(left(8)).toBeNull();
    expect(trialDaysLeft(decideAccess({ entitlement: none, trialStartedAt: null, now: NOW }), NOW)).toBeNull();
  });
});

describe("paying", () => {
  it("lets a paid plan in whatever the free week says", () => {
    const paid = { tier: "access", status: "active" } as const;
    expect(decideAccess({ entitlement: paid, trialStartedAt: ago(40), now: NOW })).toMatchObject({
      allowed: true,
      reason: "paid",
    });
  });

  it("keeps someone in while their card is retried", () => {
    const retrying = { tier: "founders", status: "past_due" } as const;
    expect(decideAccess({ entitlement: retrying, trialStartedAt: ago(40), now: NOW }).allowed).toBe(true);
  });

  it("closes a plan that was cancelled, and says it lapsed rather than that the week ended", () => {
    const lapsed = { tier: "access", status: "canceled" } as const;
    expect(decideAccess({ entitlement: lapsed, trialStartedAt: null, now: NOW })).toMatchObject({
      allowed: false,
      reason: "lapsed",
    });
  });
});
