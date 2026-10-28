import { redirect } from "next/navigation";

import { Conversation } from "@/components/chat/Conversation";
import { BrandHeader } from "@/components/BrandHeader";
import { DecryptionError, SessionKeyDestroyedError } from "@/lib/echo/crypto";
import { SESSION_CLOSED, SESSION_UNREADABLE } from "@/lib/echo/messages";
import { sessionStore } from "@/lib/echo/store-factory";
import { findStranded, resumeOrStartSession } from "@/lib/echo/sessions";
import { classifyError } from "@/lib/echo/telemetry";
import { toDisplayTurns, type DisplayTurn } from "@/lib/echo/transcript";
import { currentUser } from "@/lib/auth/current-user";
import { accessFor } from "@/lib/billing/entitlements";

/**
 * Resuming happens here, and it is the whole product in one function: the
 * server decrypts the conversation, renders it, and hands the browser a copy
 * that exists only in that tab's memory. No client cache, so opening the app on
 * a second device shows the same conversation with no reconciliation.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/chat");

  let turns: DisplayTurn[];
  try {
    const store = await sessionStore();
    // A conversation left unfinished mid-closing: ask, never guess.
    if (await findStranded(store, user.id)) return <StrandedChoice />;
    const session = await resumeOrStartSession(store, user.id);
    turns = toDisplayTurns(session.transcript);
  } catch (error) {
    if (error instanceof SessionKeyDestroyedError) return <Stopped message={SESSION_CLOSED} />;
    if (error instanceof DecryptionError) return <Stopped message={SESSION_UNREADABLE} />;
    console.error(`[chat] could not open session: ${classifyError(error)}`);
    throw error;
  }

  // No access right now (the free conversation is used, or a plan lapsed): the plans are shown
  // straight away. A failure to check must never lock someone out, so any doubt means "carry on".
  const purchase = await accessFor(user.id)
    .then((access) =>
      access.allowed ? null : access.reason === "lapsed" ? ("lapsed" as const) : ("needs-purchase" as const),
    )
    .catch(() => null);

  return (
    <>
      {/* No trailing slot here any more — the account icon is mounted globally
          (components/AccountMenu.tsx, in app/layout.tsx) so it sits in the same
          top-right spot on every page, not just this one. */}
      <BrandHeader />
      <Conversation initialTurns={turns} initialPurchase={purchase} />
    </>
  );
}

/** Pick up an unfinished conversation, or start fresh (which destroys it). */
function StrandedChoice() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-5">
      <h1 className="text-2xl font-medium tracking-tight">You left a conversation unfinished</h1>
      <p className="leading-relaxed text-ink-soft">
        It was part-way through being closed when you left. You can pick it up where it stopped, or
        start something new.
      </p>
      <p
        role="alert"
        className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-ink"
      >
        <strong className="font-medium">Starting something new ends the earlier conversation for good.</strong>{" "}
        It is destroyed, and can&rsquo;t be brought back or read again.
      </p>
      <form action="/api/chat/stranded" method="post" className="mt-1 flex flex-wrap gap-3">
        <button
          type="submit"
          name="choice"
          value="resume"
          className="fx-primary rounded-full bg-accent px-6 py-2.5 text-base font-medium text-on-accent"
        >
          Pick it up
        </button>
        <button
          type="submit"
          name="choice"
          value="fresh"
          className="rounded-full border border-line px-6 py-2.5 text-base text-ink-soft fx-soft"
        >
          Start something new
        </button>
      </form>
    </main>
  );
}

function Stopped({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 text-center">
      <p className="text-base leading-relaxed text-ink-soft">{message}</p>
    </main>
  );
}
