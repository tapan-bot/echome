import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth/fields";
import { PoweredBy } from "@/components/PoweredBy";
import { currentUser } from "@/lib/auth/current-user";
import { DISCLAIMER } from "@/lib/echo/messages";
import { xtiles } from "@/lib/xtiles/factory";

/**
 * The hub every sign-in lands on — two main options, nothing else competing
 * for attention. "Start a conversation" always works; resumeOrStartSession
 * picks up an open one automatically, so there's no separate "continue"
 * choice to design for. "Connect xTiles" only matters once: after that, this
 * option quietly reports that it's done rather than asking again.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { checkout } = await searchParams;
  const user = await currentUser();
  if (!user) redirect("/login?next=/welcome");

  const connected = await (await xtiles()).isConnected(user.id).catch(() => false);

  return (
    <AuthShell>
      <h1 className="text-center text-2xl font-medium tracking-tight">You&rsquo;re in</h1>
      <p className="mt-2 text-center text-sm text-ink-soft">
        Two things you can do from here.
      </p>

      {checkout === "complete" ? (
        <p className="mt-5 rounded-xl border border-success/40 bg-success-soft px-3.5 py-2.5 text-center text-sm leading-relaxed text-ink">
          Payment received — you&rsquo;re all set.
        </p>
      ) : null}

      <div className="mt-7 flex flex-col gap-3">
        <a
          href="/chat"
          className="echo-rise group flex items-center gap-3.5 fx-calm rounded-2xl px-4 py-3.5"
        >
          <IconBadge tone="accent">
            <ChatIcon />
          </IconBadge>
          <span className="flex flex-1 flex-col gap-0.5">
            <span className="text-base font-medium">Start a conversation</span>
            <span className="text-sm text-ink-soft">
              Pick up where you left off, or begin something new.
            </span>
          </span>
          <Chevron />
        </a>

        {connected ? (
          <a
            href="/account"
            className="echo-rise group flex items-center gap-3.5 fx-calm rounded-2xl px-4 py-3.5"
            style={{ animationDelay: "70ms" }}
          >
            <IconBadge tone="success">
              <CheckIcon />
            </IconBadge>
            <span className="flex flex-1 flex-col gap-0.5">
              <span className="text-base font-medium">xTiles connected</span>
              <span className="text-sm text-ink-soft">What you keep from a conversation goes here.</span>
            </span>
            <Chevron />
          </a>
        ) : (
          <form action="/api/xtiles/connect" method="post">
            <button
              type="submit"
              className="echo-rise group flex w-full items-center gap-3.5 fx-calm rounded-2xl px-4 py-3.5 text-left"
              style={{ animationDelay: "70ms" }}
            >
              <IconBadge tone="accent">
                <TilesIcon />
              </IconBadge>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-base font-medium">Connect your xTiles workspace</span>
                <span className="text-sm text-ink-soft">
                  So there&rsquo;s somewhere for what you keep to go.
                </span>
              </span>
              <Chevron />
            </button>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-xs leading-relaxed text-ink-soft">{DISCLAIMER}</p>
      <PoweredBy className="mt-3" />
    </AuthShell>
  );
}

function IconBadge({ tone, children }: { tone: "accent" | "success"; children: React.ReactNode }) {
  const toneClass =
    tone === "success" ? "bg-success/25 text-ink" : "bg-accent/30 text-ink";
  return (
    <span
      className={`flex size-11 shrink-0 items-center justify-center rounded-xl transition group-hover:scale-105 ${toneClass}`}
    >
      {children}
    </span>
  );
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-ink-soft transition group-hover:translate-x-0.5 group-hover:text-ink"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4.5h16v12H9l-4.5 4V4.5Z" />
      <path d="M8 9.5h8M8 13h5" />
    </svg>
  );
}

function TilesIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 13l4.5 4.5L19 7" />
    </svg>
  );
}
