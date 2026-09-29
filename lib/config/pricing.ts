/**
 * Pricing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Confirmed by Tapan (2026-09-28): Access $9.99 one-time, Founders $14.99/mo.
 *
 *  The amounts below are for display only and are NOT what Stripe charges.
 *  Stripe charges whatever the price object identified by priceIdEnv says.
 *  STRIPE_PRICE_ACCESS / STRIPE_PRICE_FOUNDERS are still unset as of this
 *  writing (see HANDOFF.md §6) — until real Stripe Price objects exist at
 *  $9.99 and $14.99/mo and those env vars point at them, checkout has nothing
 *  to charge against. Getting the label right here does not by itself make
 *  the charge right; both need doing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type Tier = "access" | "founders";

export interface TierConfig {
  readonly id: Tier;
  readonly name: string;
  readonly blurb: string;
  /** For display. Stripe is the authority on what is actually charged. */
  readonly displayPrice: string;
  readonly cadence: "one-time" | "monthly";
  readonly mode: "payment" | "subscription";
  /** Stripe price id, from the environment. */
  readonly priceIdEnv: "STRIPE_PRICE_ACCESS" | "STRIPE_PRICE_FOUNDERS";
  readonly features: readonly string[];
}

export const TIERS: Readonly<Record<Tier, TierConfig>> = {
  access: {
    id: "access",
    name: "Access",
    blurb: "Pay once. Yours to keep.",
    displayPrice: "$9.99",
    cadence: "one-time",
    mode: "payment",
    priceIdEnv: "STRIPE_PRICE_ACCESS",
    features: [
      "Unlimited reflective conversations",
      // "Compass" was cut per Todd's skill v3.11 (HANDOFF.md §2.10) — EchoMe
      // reads the person's own EchoCompass but never writes it. What the app
      // actually writes is the EchoMap entry.
      "Your EchoMap, written to your own xTiles workspace",
      "Nothing you say is ever stored in readable form",
    ],
  },
  founders: {
    id: "founders",
    name: "Founders",
    blurb: "Monthly, with the Echo Circle.",
    displayPrice: "$14.99/mo",
    cadence: "monthly",
    mode: "subscription",
    priceIdEnv: "STRIPE_PRICE_FOUNDERS",
    features: [
      "Everything in Access",
      "The Echo Circle community",
      "Shape what EchoMe becomes",
    ],
  },
};

export function priceIdFor(tier: Tier): string {
  const value = process.env[TIERS[tier].priceIdEnv];
  if (!value) {
    throw new Error(`${TIERS[tier].priceIdEnv} is not set — cannot start checkout for ${tier}.`);
  }
  return value;
}

/**
 * Whether the free introductory conversation requires an account.
 *
 * The build brief asks: "[Confirm with the client whether this requires an
 * account.]" Requiring one is the safer default — it means the free session is
 * once per person rather than once per browser, and it means a conversation
 * someone starts is still there tomorrow, which is the whole product.
 */
export const FREE_INTRO_REQUIRES_ACCOUNT = true;
