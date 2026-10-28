"use client";

import Link from "next/link";
import { useState } from "react";

import { AuthOrbs } from "@/components/auth/AuthOrbs";
import { EchoDots } from "@/components/EchoLoader";
import { passwordStrength } from "@/lib/auth/password-strength";

/** Shared form pieces, so the sign-in panel and the other auth pages match. */

export const INPUT =
  "w-full rounded-full border border-line bg-page px-5 py-3 text-base " +
  "outline-none transition focus:border-accent focus:ring-2 focus:ring-accent-soft";

export function EmailField({ autoFocus = false }: { autoFocus?: boolean }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm text-ink-soft">Email</span>
      <input
        className={INPUT}
        type="email"
        name="email"
        autoComplete="email"
        required
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={autoFocus}
      />
    </label>
  );
}

export function PasswordField({
  label = "Password",
  autoComplete = "current-password",
  trailing,
}: {
  label?: string;
  autoComplete?: "current-password" | "new-password";
  /** Rendered top-right of the label row — the "Forgotten password?" link. */
  trailing?: React.ReactNode;
}) {
  // The strength meter only makes sense while someone is choosing a new
  // password — signing in with an existing one gets no meter.
  const showStrength = autoComplete === "new-password";
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);

  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between">
        <span className="text-sm text-ink-soft">{label}</span>
        {trailing}
      </span>
      <span className="relative flex items-center">
        <input
          className={`${INPUT} pr-12`}
          type={visible ? "text" : "password"}
          name="password"
          autoComplete={autoComplete}
          required
          minLength={8}
          value={showStrength ? value : undefined}
          onChange={showStrength ? (event) => setValue(event.target.value) : undefined}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
          className="absolute right-4 flex items-center text-ink-soft transition hover:text-ink"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </span>
      {showStrength ? <PasswordStrengthMeter value={value} /> : null}
    </label>
  );
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17.2 17.2 0 0 1-3.4 4.3M6.6 6.6C4 8.3 2 12 2 12s3.6 7 10 7a10.4 10.4 0 0 0 4.4-.95" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

/** A bar that fills and recolors as the password gets stronger, plus a label
    for anyone using a screen reader. Width and color both transition, so
    typing reads as continuous motion rather than a state that snaps. */
function PasswordStrengthMeter({ value }: { value: string }) {
  const { level, label } = passwordStrength(value);
  const widthPercent = value.length === 0 ? 0 : ((level + 1) / 5) * 100;
  const color =
    level <= 1 ? "var(--color-warn)" : level === 2 ? "var(--color-accent)" : "var(--color-success)";

  return (
    <div className="mt-1 flex flex-col gap-1" aria-hidden={value.length === 0}>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full transition-[width,background-color] duration-300 ease-out"
          style={{ width: `${widthPercent}%`, backgroundColor: color }}
        />
      </div>
      {value.length > 0 ? (
        <p role="status" className="text-xs text-ink-soft">
          {label}
        </p>
      ) : null}
    </div>
  );
}

export function PrimaryButton({
  pending,
  children,
}: {
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-accent px-6 py-3 text-base font-medium text-on-accent fx-primary disabled:opacity-50"
    >
      {pending ? <EchoDots label="One moment…" className="text-on-accent" /> : children}
      {pending ? null : <span aria-hidden="true">→</span>}
    </button>
  );
}

/** Reserves its own height so the form does not jump when a message appears. */
export function FormMessage({ error, notice }: { error?: string; notice?: string }) {
  return (
    <p aria-live="polite" className="min-h-5 text-sm leading-relaxed">
      {error ? <span className="text-warn">{error}</span> : null}
      {notice ? <span className="text-ink-soft">{notice}</span> : null}
    </p>
  );
}

export function AuthLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-accent underline underline-offset-4 hover:text-ink">
      {children}
    </Link>
  );
}

/**
 * The card every auth screen sits inside — a soft radial glow behind a
 * rounded, bordered card, with EchoMe's mark anchoring the top. Same shell
 * language across sign in, sign up, reset, and local mode, so the "feel" is
 * consistent everywhere a person signs in.
 *
 * The two corner rings are a borrowed layout idea (a client reference showed
 * large decorative circle outlines bleeding off the screen edges) — kept in
 * EchoMe's own violet, not the reference's teal, so it still reads as this
 * app rather than a different one.
 */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main
      className="relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10"
      style={{
        background:
          "radial-gradient(120% 100% at 50% 0%, color-mix(in oklch, var(--color-accent-soft) 45%, var(--color-page)) 0%, var(--color-page) 60%)",
      }}
    >
      <AuthOrbs />

      <div
        className="relative w-full max-w-sm rounded-3xl border border-line px-7 py-9 backdrop-blur-2xl"
        style={{
          background: "color-mix(in oklch, var(--color-raised) 68%, transparent)",
          boxShadow:
            "inset 0 1px 0 color-mix(in oklch, var(--color-on-accent) 12%, transparent), " +
            "0 1px 2px rgba(0,0,0,0.04), 0 18px 40px -20px rgba(0,0,0,0.25)",
        }}
      >
        {children}
      </div>
    </main>
  );
}
