import { PlanCards } from "@/components/PlanCards";
import { PoweredBy } from "@/components/PoweredBy";
import { currentUser } from "@/lib/auth/current-user";
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
          Your first week is free. After that, choose how you&rsquo;d like to continue.
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

      <PlanCards signedIn={Boolean(user)} />

      <p className="text-xs leading-relaxed text-ink-soft">{DISCLAIMER}</p>
      <PoweredBy className="text-left" />
    </main>
  );
}
