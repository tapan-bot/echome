"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { TIERS } from "@/lib/config/pricing";

/**
 * The avatar in the header. Click it and a frosted glass panel drops down —
 * identity up top, then the places the rest of the account lives, styled
 * after a client reference (a translucent, blurred options panel with
 * icon rows). Kept in EchoMe's own violet rather than the reference's blue.
 */
export function ProfileMenu({
  email,
  planLabel,
  tier,
  xtilesConnected,
  signOutAction,
}: {
  email: string | null;
  planLabel: string;
  /** The plan they pay for now, or "none" (free, or lapsed). */
  tier: "none" | "access" | "founders";
  xtilesConnected: boolean;
  signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initial = (email?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-medium text-on-accent fx-primary"
      >
        {initial}
      </button>

      {open ? (
        <div
          role="menu"
          className="echo-rise absolute right-0 top-full z-20 mt-2 w-72 overflow-hidden rounded-2xl border border-line backdrop-blur-2xl"
          style={{
            background: "color-mix(in oklch, var(--color-raised) 68%, transparent)",
            boxShadow:
              "inset 0 1px 0 color-mix(in oklch, var(--color-on-accent) 12%, transparent), " +
              "0 1px 2px rgba(0,0,0,0.04), 0 24px 48px -20px rgba(0,0,0,0.45)",
          }}
        >
          <div className="flex items-center gap-3 border-b border-line px-4 py-3.5">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-base font-medium text-on-accent">
              {initial}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">{email ?? "Signed in"}</span>
                <span className="shrink-0 rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  {planLabel}
                </span>
              </span>
            </span>
          </div>

          <div className="flex flex-col gap-0.5 p-1.5">
            {tier === "none" ? (
              <UpgradeLink
                href="/pricing"
                title="Upgrade plan"
                hint={`From ${TIERS.access.displayPrice}`}
                onNavigate={() => setOpen(false)}
              />
            ) : (
              // They already pay, so a second checkout would start a second subscription.
              // Changing or managing a plan is done in Stripe's own customer portal.
              <form action="/api/stripe/portal" method="post">
                <UpgradeButton
                  title={tier === "access" ? "Upgrade to Founders" : "Manage plan"}
                  hint={tier === "access" ? TIERS.founders.displayPrice : TIERS[tier].name}
                />
              </form>
            )}
            <MenuLink href="/account" onNavigate={() => setOpen(false)} icon={<TilesIcon />}>
              <span className="flex flex-1 items-center justify-between">
                xTiles integration
                <StatusDot connected={xtilesConnected} />
              </span>
            </MenuLink>
            <MenuLink href="/account" onNavigate={() => setOpen(false)} icon={<UserIcon />}>
              Account
            </MenuLink>
            <MenuLink href="/settings" onNavigate={() => setOpen(false)} icon={<GearIcon />}>
              Settings
            </MenuLink>
            <MenuLink href="/policy" onNavigate={() => setOpen(false)} icon={<ShieldIcon />}>
              Privacy policy
            </MenuLink>
          </div>

          <div className="mx-1.5 border-t border-line" />

          <div className="p-1.5">
            <form action={signOutAction}>
              <button
                type="submit"
                role="menuitem"
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-ink-soft transition hover:bg-accent-soft hover:text-ink"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-page text-ink-soft">
                  <LogoutIcon />
                </span>
                Sign out
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuLink({
  href,
  onNavigate,
  icon,
  children,
}: {
  href: string;
  onNavigate: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ink-soft transition hover:translate-x-0.5 hover:bg-accent-soft hover:text-ink"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-page text-ink-soft">
        {icon}
      </span>
      {children}
    </Link>
  );
}

/** The row that stands out in the menu: where to go to pay for more. */
function UpgradeLink({
  href,
  title,
  hint,
  onNavigate,
}: {
  href: string;
  title: string;
  hint: string;
  onNavigate: () => void;
}) {
  return (
    <Link href={href} role="menuitem" onClick={onNavigate} className={UPGRADE_CLASS}>
      <UpgradeBody title={title} hint={hint} />
    </Link>
  );
}

function UpgradeButton({ title, hint }: { title: string; hint: string }) {
  return (
    <button type="submit" role="menuitem" className={`${UPGRADE_CLASS} w-full text-left`}>
      <UpgradeBody title={title} hint={hint} />
    </button>
  );
}

const UPGRADE_CLASS =
  "fx-primary flex items-center gap-3 rounded-xl bg-accent px-3 py-2.5 text-sm text-on-accent";

function UpgradeBody({ title, hint }: { title: string; hint: string }) {
  return (
    <>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-on-accent/15">
        <ArrowUpIcon />
      </span>
      <span className="flex flex-1 items-center justify-between gap-2">
        <span className="font-medium">{title}</span>
        <span className="text-xs opacity-85">{hint}</span>
      </span>
    </>
  );
}

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${connected ? "bg-success" : "bg-ink-soft"}`}
      />
      <span className={connected ? "text-success" : "text-ink-soft"}>
        {connected ? "Connected" : "Not connected"}
      </span>
    </span>
  );
}

const ICON_PROPS = {
  viewBox: "0 0 24 24",
  width: 18,
  height: 18,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function TilesIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.5 20c1.4-3.6 4.4-5.5 7.5-5.5s6.1 1.9 7.5 5.5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}
