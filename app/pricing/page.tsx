import { PoweredBy } from "@/components/PoweredBy";
import { currentUser } from "@/lib/auth/current-user";
import { TIERS } from "@/lib/config/pricing";
import { DISCLAIMER } from "@/lib/echo/messages";

export const dynamic = "force-dynamic";

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  const user = await currentUser();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-6 px-5 py-14">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Keep going</h1>
        <p className="mt-2 text-ink-soft">
          One conversation is free. After that, choose how you&rsquo;d like to continue.
        </p>
      </div>

      {checkout === "cancelled" ? (
        <p className="rounded-xl border border-line bg-raised px-4 py-3 text-sm text-ink-soft">
          Checkout was cancelled. Nothing was charged.
        </p>
      ) : null}
      {checkout === "error" ? (
        <p className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-ink">
          We couldn&rsquo;t start checkout just then. Nothing was charged — please try again.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {Object.values(TIERS).map((tier) => (
          <div key={tier.id} className="flex flex-col gap-3 rounded-xl border border-line bg-raised p-5">
            <div>
              <h2 className="text-lg font-medium">{tier.name}</h2>
              <p className="text-sm text-ink-soft">{tier.blurb}</p>
            </div>
            <p className="text-2xl">{tier.displayPrice}</p>
            <ul className="flex flex-1 flex-col gap-1.5 text-sm text-ink-soft">
              {tier.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            {user ? (
              <form action="/api/stripe/checkout" method="post">
                <input type="hidden" name="tier" value={tier.id} />
                <button
                  type="submit"
                  className="w-full rounded-lg bg-accent px-4 py-2.5 font-medium text-on-accent"
                >
                  Choose {tier.name}
                </button>
              </form>
            ) : (
              <a
                href="/signup"
                className="rounded-lg border border-line px-4 py-2.5 text-center text-ink-soft"
              >
                Create an account first
              </a>
            )}
          </div>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-ink-soft">{DISCLAIMER}</p>
      <PoweredBy className="text-left" />
    </main>
  );
}
