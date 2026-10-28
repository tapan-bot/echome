import { TIERS, type Tier } from "@/lib/config/pricing";

/**
 * The plans, with their prices, as cards. One place for them, so the pricing page and
 * the chat (where someone's free week has just ended) show exactly the same
 * thing: the price up front, and one button to choose it.
 *
 * What is shown is display only. Stripe charges whatever its price object says, and
 * checkout is a hosted Stripe page: card details never reach EchoMe.
 */
export function PlanCards({
  signedIn = true,
  compact = false,
  only,
}: {
  signedIn?: boolean;
  /** Tighter, for use inside the chat. */
  compact?: boolean;
  /** Show only these plans. */
  only?: readonly Tier[];
}) {
  const tiers = Object.values(TIERS).filter((tier) => !only || only.includes(tier.id));

  return (
    <div className={`grid gap-3 ${tiers.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {tiers.map((tier) => {
        // "$19.95/mo" reads better as a big number with a small unit.
        const [amount, unit] = tier.displayPrice.split("/");
        const featured = tier.id === "founders";
        return (
          <div
            key={tier.id}
            className={`fx-card flex flex-col gap-3 rounded-2xl border ${compact ? "p-4" : "p-5"} ${
              featured ? "border-accent bg-accent-soft" : "border-line bg-raised"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-medium">{tier.name}</h3>
              {featured ? (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-accent">
                  Echo Circle
                </span>
              ) : null}
            </div>
            <p className="flex items-baseline gap-1">
              <span className="font-display text-3xl tracking-tight">{amount}</span>
              <span className="text-sm text-ink-soft">/ {unit ?? "month"}</span>
            </p>
            <p className="text-sm text-ink-soft">{tier.blurb}</p>
            <ul className={`flex flex-1 flex-col gap-1.5 text-ink-soft ${compact ? "text-xs" : "text-sm"}`}>
              {tier.features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span aria-hidden="true" className="mt-0.5 text-success">
                    ✓
                  </span>
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
            {signedIn ? (
              <form action="/api/stripe/checkout" method="post">
                <input type="hidden" name="tier" value={tier.id} />
                <button
                  type="submit"
                  className="fx-primary w-full rounded-full bg-accent px-4 py-2.5 font-medium text-on-accent"
                >
                  Choose {tier.name}
                </button>
              </form>
            ) : (
              <a
                href="/signup"
                className="fx-soft rounded-full px-4 py-2.5 text-center"
              >
                Create an account first
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
