"use client";

import { useActionState, useState } from "react";

import { sendMagicLink, signIn, type AuthState } from "@/app/(auth)/actions";
import { localSignIn } from "@/app/(auth)/local-actions";
import { AuthTabs } from "@/components/auth/AuthTabs";
import { PoweredBy } from "@/components/PoweredBy";
import { OAuthButtons, OrDivider } from "@/components/auth/OAuthButtons";
import {
  AuthLink,
  AuthShell,
  EmailField,
  FormMessage,
  PasswordField,
  PrimaryButton,
} from "@/components/auth/fields";
import { DISCLAIMER_SHORT } from "@/lib/echo/messages";

/**
 * The sign-in page — the ONLY sign-in screen, in both local mode and the real
 * app. They used to be two separate components that could drift apart; now
 * local mode swaps only the action each form submits to, never the markup.
 *
 * `localMode` arrives as a prop rather than being read from LOCAL_MODE in this
 * file on purpose: this is a "use client" component, and ECHOME_LOCAL_MODE is
 * not a NEXT_PUBLIC_ variable, so it evaluates to undefined in the browser
 * bundle. Reading it here would make the server render one branch and the
 * client hydrate a different one — a hydration mismatch. The caller (a server
 * component) reads LOCAL_MODE correctly and passes the resolved boolean down.
 *
 * Three ways in, in the order most people will use them: a social provider, a
 * password, or a link in the post. The mode toggle swaps the bottom half only —
 * the social buttons stay put, so nothing moves under the cursor.
 *
 * In local mode, "password" and "magic link" both resolve to the same thing —
 * localSignIn, which only ever looks at the email field — because local mode
 * has no real password and sends no real email. The password field still
 * renders and still requires 8 characters client-side, purely so the two
 * screens are pixel-identical; whatever is typed there is ignored.
 */

type Mode = "password" | "link";

export function SignInPanel({
  next,
  banner,
  localMode,
}: {
  next?: string;
  banner?: string;
  localMode: boolean;
}) {
  const [mode, setMode] = useState<Mode>("password");

  return (
    <AuthShell>
      <h1 className="text-center text-2xl font-medium tracking-tight">Welcome back</h1>
      <p className="mt-2 text-center text-sm text-ink-soft">Your conversation is where you left it.</p>

      <div className="mt-6">
        <AuthTabs active="signin" />
      </div>

      {banner ? (
        <p
          role="status"
          className="mt-5 rounded-xl border border-warn/40 bg-warn-soft px-3.5 py-2.5 text-sm leading-relaxed text-ink"
        >
          {banner}
        </p>
      ) : null}

      <div className="mt-8">
        <OAuthButtons next={next} />
      </div>

      <div className="mt-5">
        <OrDivider />
      </div>

      {mode === "password" ? (
        <PasswordMode next={next} localMode={localMode} onUseLink={() => setMode("link")} />
      ) : (
        <LinkMode next={next} localMode={localMode} onUsePassword={() => setMode("password")} />
      )}

      <div className="mt-6 text-center text-xs text-ink-soft">{DISCLAIMER_SHORT}</div>
      <PoweredBy className="mt-3" />
    </AuthShell>
  );
}

function PasswordMode({
  next,
  localMode,
  onUseLink,
}: {
  next?: string;
  localMode: boolean;
  onUseLink: () => void;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    localMode ? localSignIn : signIn,
    {},
  );

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <EmailField />
      {/* /reset is a real-Supabase-only flow with nothing to talk to in local
          mode, and there is no real password there to forget in the first
          place — so the link is omitted rather than left to fail. */}
      <PasswordField trailing={localMode ? undefined : <AuthLink href="/reset">Forgotten?</AuthLink>} />
      <PrimaryButton pending={pending}>Sign in</PrimaryButton>
      <FormMessage error={state.error} notice={state.notice} />
      <ModeToggle onClick={onUseLink}>Email me a link instead</ModeToggle>
    </form>
  );
}

function LinkMode({
  next,
  localMode,
  onUsePassword,
}: {
  next?: string;
  localMode: boolean;
  onUsePassword: () => void;
}) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    localMode ? localSignIn : sendMagicLink,
    {},
  );

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <EmailField />
      <p className="-mt-1 text-sm leading-relaxed text-ink-soft">
        {localMode
          ? "There's no real email here — this signs you in immediately."
          : "No password needed. We’ll send a link that signs you in."}
      </p>
      <PrimaryButton pending={pending}>Send me a link</PrimaryButton>
      <FormMessage error={state.error} notice={state.notice} />
      <ModeToggle onClick={onUsePassword}>Use a password instead</ModeToggle>
    </form>
  );
}

function ModeToggle({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start underline underline-offset-4 hover:text-ink"
    >
      {children}
    </button>
  );
}
