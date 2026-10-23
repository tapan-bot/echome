import { redirect } from "next/navigation";

import { PoweredBy } from "@/components/PoweredBy";
import { currentUser } from "@/lib/auth/current-user";
import { entitlementFor } from "@/lib/billing/entitlements";
import { TIERS } from "@/lib/config/pricing";
import { LOCAL_MODE } from "@/lib/local/mode";
import { xtiles } from "@/lib/xtiles/factory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** What to tell someone after they come back from connecting xTiles. */
const XTILES_MESSAGES: Readonly<Record<string, string>> = {
  connected: "xTiles is connected, and your EchoHub was found.",
  nohub:
    "xTiles is connected, but I couldn't find your EchoHub project yet. I can set one up for you, or you can add the EchoMe template to your xTiles yourself and check again.",
  hubcreated:
    "Your EchoHub is set up in xTiles: an EchoCompass for you to fill in, and an EchoMap that EchoMe will add to.",
  hubfailed:
    "I couldn't set up your EchoHub just now. Before you try again, check your xTiles for an EchoHub, so you don't end up with two.",
  denied: "You chose not to allow access, so nothing was connected. You can try again whenever you like.",
  error: "That connection didn't complete. Please try again.",
  disconnected: "xTiles is disconnected. What's already in your xTiles is untouched.",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ portal?: string; xtiles?: string }>;
}) {
  const { portal, xtiles: xtilesStatus } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?next=/account");

  const entitlement = await entitlementFor(user.id);
  const adapter = await xtiles();
  const connected = await adapter.isConnected(user.id).catch(() => false);
  // Is there an EchoHub to write to? Asked here so a member who is already
  // connected, but has no hub yet, is offered the setup without having to
  // reconnect first. A slow or failing xTiles must not hold the page up: any
  // doubt means "don't know", and nothing is offered on a guess.
  const workspace: "ready" | "no-hub" | "unknown" =
    connected && !xtilesStatus
      ? await Promise.race([
          adapter.checkWorkspace(user.id),
          new Promise<"unknown">((resolve) => setTimeout(() => resolve("unknown"), 4000)),
        ]).catch(() => "unknown" as const)
      : "unknown";
  const needsHub = xtilesStatus === "nohub" || xtilesStatus === "hubfailed" || workspace === "no-hub";
  // Where members add the EchoMe template to their xTiles. Set once xTiles has made the link.
  const templateUrl = process.env.XTILES_TEMPLATE_URL ?? null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-7 px-5 py-14">
      <h1 className="text-2xl font-medium tracking-tight">Your account</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">Signed in as</h2>
        <p className="text-ink-soft">{user.email ?? user.id}</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Plan</h2>
        <p className="text-ink-soft">
          {entitlement.tier === "none"
            ? "No plan yet — you have one free conversation."
            : `${TIERS[entitlement.tier].name} · ${entitlement.status}`}
          {LOCAL_MODE ? " (local mode unlocks everything)" : null}
        </p>
        {entitlement.stripeCustomerId ? (
          <form action="/api/stripe/portal" method="post">
            <button type="submit" className="rounded-lg border border-line px-4 py-2.5 text-ink-soft">
              Manage billing
            </button>
          </form>
        ) : (
          <a href="/pricing" className="self-start rounded-lg bg-accent px-4 py-2.5 font-medium text-on-accent">
            Choose a plan
          </a>
        )}
        {portal === "error" ? (
          <p className="text-sm text-ink-soft">We couldn&rsquo;t open the billing portal. Try again shortly.</p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">xTiles workspace</h2>
        <p className="text-ink-soft">
          {connected
            ? "Connected. What you keep from a conversation is written here."
            : "Not connected. Without it, a conversation can be ended but nothing can be kept."}
        </p>
        {xtilesStatus && XTILES_MESSAGES[xtilesStatus] ? (
          <p role="status" className="text-sm leading-relaxed text-ink">
            {XTILES_MESSAGES[xtilesStatus]}
          </p>
        ) : workspace === "no-hub" ? (
          <p role="status" className="text-sm leading-relaxed text-ink">
            {XTILES_MESSAGES.nohub}
          </p>
        ) : null}
        {templateUrl && (needsHub || !connected) ? (
          <a
            href={templateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start text-sm text-accent underline underline-offset-4"
          >
            Add the EchoMe template to your xTiles
          </a>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {!connected ? (
            <form action="/api/xtiles/connect" method="post">
              <button type="submit" className="rounded-lg border border-line px-4 py-2.5 text-ink-soft">
                Connect xTiles
              </button>
            </form>
          ) : (
            <>
              {needsHub ? (
                <form action="/api/xtiles/setup-hub" method="post">
                  <button type="submit" className="rounded-lg bg-accent px-4 py-2.5 font-medium text-on-accent">
                    Set up my EchoHub
                  </button>
                </form>
              ) : null}
              {needsHub ? (
                <form action="/api/xtiles/check" method="post">
                  <button type="submit" className="rounded-lg border border-line px-4 py-2.5 text-ink-soft">
                    Check again
                  </button>
                </form>
              ) : null}
              {!LOCAL_MODE ? (
                <form action="/api/xtiles/disconnect" method="post">
                  <button type="submit" className="rounded-lg border border-line px-4 py-2.5 text-ink-soft">
                    Disconnect
                  </button>
                </form>
              ) : null}
            </>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-6">
        <h2 className="text-sm font-medium">Your conversations</h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          We cannot show you a history, because we do not keep one. A conversation exists only
          while it is open, encrypted with a key that belongs to it alone. When you end it, that
          key is destroyed and what you chose to keep lives in your xTiles, not here.
        </p>
      </section>

      <PoweredBy />
    </main>
  );
}
