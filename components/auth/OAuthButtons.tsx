"use client";

import { useFormStatus } from "react-dom";

import { signInWithProvider } from "@/app/(auth)/actions";
import { OAUTH_PROVIDERS, PROVIDERS, type OAuthProvider } from "@/lib/auth/providers";

/**
 * One button per social provider, driven by the registry in lib/auth/providers.
 *
 * A provider without real credentials yet (PROVIDERS[id].enabled === false)
 * renders as a disabled "Soon" button instead of a live form — same mark, same
 * label, same shape, so turning it on later is a one-line flag flip in
 * providers.ts and nothing about this component changes.
 *
 * Enabled buttons are each their own form so the provider travels as a hidden
 * field and the whole thing works before hydration — someone on a slow
 * connection can sign in while the JavaScript is still arriving.
 */

export function OAuthButtons({ next }: { next?: string }) {
  return (
    <div className="flex flex-col gap-2.5">
      {OAUTH_PROVIDERS.map((provider) =>
        PROVIDERS[provider].enabled ? (
          <form key={provider} action={signInWithProvider}>
            <input type="hidden" name="provider" value={provider} />
            {next ? <input type="hidden" name="next" value={next} /> : null}
            <ProviderButton provider={provider} />
          </form>
        ) : (
          <TempProviderButton key={provider} provider={provider} />
        ),
      )}
    </div>
  );
}

function ProviderButton({ provider }: { provider: OAuthProvider }) {
  const { pending } = useFormStatus();
  const { label } = PROVIDERS[provider];

  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-3 rounded-full border-[1.5px] border-accent bg-accent-soft px-5 py-3 text-base font-medium transition hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_8px_20px_-14px_var(--color-accent)] active:translate-y-0 disabled:opacity-50"
    >
      <ProviderMark provider={provider} />
      <span>{pending ? "One moment…" : `Continue with ${label}`}</span>
    </button>
  );
}

/** Not wired up yet — same shape as the real button, visibly inert. */
function TempProviderButton({ provider }: { provider: OAuthProvider }) {
  const { label } = PROVIDERS[provider];

  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      title={`${label} sign-in isn't connected yet`}
      className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-full border border-dashed border-line bg-page px-5 py-3 text-sm font-medium text-ink-soft opacity-60 sm:text-base"
    >
      <ProviderMark provider={provider} />
      <span className="whitespace-nowrap">Continue with {label}</span>
      <span className="ml-0.5 shrink-0 rounded-full bg-line px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-soft">
        Soon
      </span>
    </button>
  );
}

/**
 * Official brand marks. Providers require their own logo on the button, so
 * these keep their brand colours in both light and dark themes rather than
 * inheriting the app's ink.
 */
function ProviderMark({ provider }: { provider: OAuthProvider }) {
  if (provider === "google") {
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="shrink-0">
        <path
          fill="#4285F4"
          d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.63h6.2a5.3 5.3 0 0 1-2.3 3.48v2.89h3.72c2.18-2 3.44-4.96 3.44-8.55z"
        />
        <path
          fill="#34A853"
          d="M12 24c3.11 0 5.72-1.03 7.62-2.8l-3.72-2.88c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.55-2.03-6.46-4.75H1.69v2.98A11.5 11.5 0 0 0 12 24z"
        />
        <path fill="#FBBC05" d="M5.54 14.67a6.9 6.9 0 0 1 0-4.42V7.27H1.69a11.51 11.51 0 0 0 0 10.38l3.85-2.98z" />
        <path
          fill="#EA4335"
          d="M12 4.75c1.69 0 3.21.58 4.4 1.72l3.3-3.3C17.71 1.2 15.1 0 12 0 7.52 0 3.64 2.57 1.69 6.32l3.85 2.98C6.45 6.58 9 4.75 12 4.75z"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="shrink-0">
      <path
        fill="#1877F2"
        d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.96h-1.51c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"
      />
    </svg>
  );
}

export function OrDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-1" aria-hidden="true">
      <span className="h-px flex-1 bg-line" />
      <span className="text-xs uppercase tracking-wide text-ink-soft">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
