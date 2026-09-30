import { redirect } from "next/navigation";

import { Conversation } from "@/components/chat/Conversation";
import { BrandHeader } from "@/components/BrandHeader";
import { DecryptionError, SessionKeyDestroyedError } from "@/lib/echo/crypto";
import { SESSION_CLOSED, SESSION_UNREADABLE } from "@/lib/echo/messages";
import { sessionStore } from "@/lib/echo/store-factory";
import { resumeOrStartSession } from "@/lib/echo/sessions";
import { classifyError } from "@/lib/echo/telemetry";
import { toDisplayTurns, type DisplayTurn } from "@/lib/echo/transcript";
import { currentUser } from "@/lib/auth/current-user";

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
    const session = await resumeOrStartSession(await sessionStore(), user.id);
    turns = toDisplayTurns(session.transcript);
  } catch (error) {
    if (error instanceof SessionKeyDestroyedError) return <Stopped message={SESSION_CLOSED} />;
    if (error instanceof DecryptionError) return <Stopped message={SESSION_UNREADABLE} />;
    console.error(`[chat] could not open session: ${classifyError(error)}`);
    throw error;
  }

  return (
    <>
      {/* No trailing slot here any more — the account icon is mounted globally
          (components/AccountMenu.tsx, in app/layout.tsx) so it sits in the same
          top-right spot on every page, not just this one. */}
      <BrandHeader />
      <Conversation initialTurns={turns} />
    </>
  );
}

function Stopped({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 text-center">
      <p className="text-base leading-relaxed text-ink-soft">{message}</p>
    </main>
  );
}
