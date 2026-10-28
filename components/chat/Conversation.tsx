"use client";

import { useEffect, useRef, useState } from "react";

import { Composer } from "@/components/chat/Composer";
import { CrisisPanel } from "@/components/chat/CrisisPanel";
import { Disclaimer } from "@/components/chat/Disclaimer";
import { PlanCards } from "@/components/PlanCards";
import { EchoDots } from "@/components/EchoLoader";
import { GENERIC_ERROR } from "@/lib/echo/messages";
import type { DisplayTurn } from "@/lib/echo/transcript";

/**
 * The conversation view.
 *
 * The transcript arrives already decrypted from the server component and lives
 * in React state for as long as the tab is open. It is never written to
 * localStorage, sessionStorage or IndexedDB. Closing the tab loses nothing,
 * because the server holds the only copy — encrypted.
 */

interface ConversationProps {
  readonly initialTurns: readonly DisplayTurn[];
  /** Set when they have no access at the moment the page opens: the plans are shown at once. */
  readonly initialPurchase?: "needs-purchase" | "lapsed" | null;
}

type Notice = { readonly kind: "error" | "refusal"; readonly text: string } | null;

export function Conversation({ initialTurns, initialPurchase = null }: ConversationProps) {
  const [turns, setTurns] = useState<DisplayTurn[]>([...initialTurns]);
  /** The reply currently arriving, token by token. */
  const [streaming, setStreaming] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [sending, setSending] = useState(false);
  /** Set by the watchman. Sticky for the rest of the session, never dismissed
      automatically — it should not vanish while someone is reading it. */
  const [flagged, setFlagged] = useState(false);
  /** Their free week has ended, or their access lapsed. The plans are shown in place of the box. */
  const [purchase, setPurchase] = useState<"needs-purchase" | "lapsed" | null>(initialPurchase);

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, streaming]);

  // The plans appear below the last message: bring them into view, so the prices are seen.
  useEffect(() => {
    if (purchase) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [purchase]);

  async function send(text: string) {
    setNotice(null);
    setSending(true);
    setTurns((current) => [
      ...current,
      { id: `local-${current.length}`, role: "user", text },
    ]);
    setStreaming("");

    let reply = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => null);
        if (body?.needsPurchase) setPurchase(body.reason === "lapsed" ? "lapsed" : "needs-purchase");
        throw new Error(body?.error ?? GENERIC_ERROR);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // NDJSON: complete lines only. A partial line stays in the buffer until
        // the rest of it arrives.
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line.length === 0) continue;

          const event = JSON.parse(line) as
            | { t: "text"; v: string }
            | { t: "flag"; v: string }
            | { t: "refusal"; v: string }
            | { t: "error"; v: string }
            | { t: "done" };

          if (event.t === "text") {
            reply += event.v;
            setStreaming(reply);
          } else if (event.t === "flag") {
            setFlagged(true);
          } else if (event.t === "refusal") {
            // Discard whatever partial text arrived and show the calm wording.
            reply = "";
            setStreaming(null);
            setNotice({ kind: "refusal", text: event.v });
          } else if (event.t === "error") {
            setNotice({ kind: "error", text: event.v });
          }
        }
      }

      if (reply.length > 0) {
        setTurns((current) => [
          ...current,
          { id: `local-${current.length}`, role: "assistant", text: reply },
        ]);
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error && error.message ? error.message : GENERIC_ERROR,
      });
    } finally {
      setStreaming(null);
      setSending(false);
    }
  }

  const empty = turns.length === 0 && streaming === null;

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-6">
          {empty ? (
            <p className="pt-16 text-center text-sm text-ink-soft">
              Say whatever you arrived with.
            </p>
          ) : null}

          <div className="flex flex-col gap-5">
            {turns.map((turn) => (
              <Turn key={turn.id} role={turn.role} text={turn.text} />
            ))}
            {streaming !== null ? <Turn role="assistant" text={streaming} pending /> : null}
          </div>

          {flagged ? <CrisisPanel /> : null}

          {purchase ? (
            <section
              aria-labelledby="plans-heading"
              className="echo-rise mt-6 flex flex-col gap-4 rounded-2xl border border-line bg-raised/60 p-4 sm:p-5"
            >
              <div>
                <h2 id="plans-heading" className="text-xl font-medium tracking-tight">
                  {purchase === "lapsed" ? "Your access has ended" : "Your free week has ended"}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
                  Your conversation is still here. Choose a plan to carry on where you left off. Cancel any time.
                </p>
              </div>
              <PlanCards compact />
              <p className="text-xs leading-relaxed text-ink-soft">
                Payment is handled by Stripe. We never see or store your card details.
              </p>
            </section>
          ) : null}

          {notice && !purchase ? (
            <p
              role="status"
              className={`mt-5 rounded-xl border px-4 py-3 text-sm leading-relaxed ${
                notice.kind === "refusal"
                  ? "border-line bg-raised text-ink-soft"
                  : "border-warn/40 bg-warn-soft text-ink"
              }`}
            >
              {notice.text}
            </p>
          ) : null}

          <div ref={bottom} className="h-px scroll-mb-40" />
        </div>
      </div>

      <div className="sticky bottom-0 bg-page">
        <Composer disabled={sending || purchase !== null} onSend={send} />
        <div className="flex items-center justify-center gap-3 pb-1">
          {turns.length > 0 ? (
            <a
              href="/close"
              className="text-xs text-ink-soft underline underline-offset-4 hover:text-ink"
            >
              Finish this conversation
            </a>
          ) : null}
        </div>
        <Disclaimer />
      </div>
    </div>
  );
}

function Turn({
  role,
  text,
  pending = false,
}: {
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
}) {
  if (role === "user") {
    return (
      <div className="echo-rise flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-raised px-4 py-2.5 text-base leading-relaxed shadow-sm ring-1 ring-line">
          {text}
        </p>
      </div>
    );
  }

  // The reply sits in a bubble on the left, the mirror image of a sent message,
  // so both sides of the conversation read the same way.
  const bubble =
    "max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-bl-lg bg-accent-soft px-4 py-2.5 text-base leading-relaxed shadow-sm ring-1 ring-line";

  // Before the first token of a reply arrives, `text` is still empty — show
  // the waiting dots instead of an empty bubble with just a cursor.
  if (pending && text.length === 0) {
    return (
      <div className="echo-rise flex justify-start">
        <div className="rounded-3xl rounded-bl-lg bg-accent-soft px-4 py-3 shadow-sm ring-1 ring-line">
          <EchoDots label="EchoMe is reflecting" />
        </div>
      </div>
    );
  }

  return (
    <div className="echo-rise flex justify-start">
      <p className={bubble}>
        {text}
        {pending ? (
          <span
            aria-label="EchoMe is replying"
            className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-ink-soft"
          />
        ) : null}
      </p>
    </div>
  );
}
