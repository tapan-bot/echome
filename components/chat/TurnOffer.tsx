"use client";

import { useEffect, useState } from "react";

/**
 * The invitation to turn the page, shown when the EchoMap has grown to the threshold.
 *
 * Only ever offered at the start of a new conversation (never mid-conversation, and never on its
 * own: the person chooses), and quietly: if the check fails for any reason it simply does not appear.
 */
export function TurnOffer() {
  const [conversations, setConversations] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/turn", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { due?: boolean; conversations?: number } | null) => {
        if (!cancelled && body?.due === true && typeof body.conversations === "number") {
          setConversations(body.conversations);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (conversations === null || dismissed) return null;

  return (
    <section
      aria-labelledby="turn-offer-heading"
      className="echo-rise mt-6 flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent-soft/50 p-4 sm:p-5"
    >
      <h2 id="turn-offer-heading" className="text-lg font-medium tracking-tight">
        Ready to turn the page?
      </h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        You&rsquo;ve kept {conversations} conversations in this EchoHub. I can gather that stretch into one short
        page and begin a fresh EchoHub from there. Nothing is deleted, and you read it before anything is written.
      </p>
      <div className="flex flex-wrap gap-3">
        <a href="/turn" className="fx-primary rounded-full bg-accent px-5 py-2 text-sm font-medium text-on-accent">
          Turn the page
        </a>
        <button type="button" onClick={() => setDismissed(true)} className="fx-soft rounded-full px-5 py-2 text-sm">
          Not now
        </button>
      </div>
    </section>
  );
}
