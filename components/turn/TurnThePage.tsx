"use client";

import { useState } from "react";

import { EchoLoader } from "@/components/EchoLoader";
import type { TurnSummary } from "@/lib/echo/turn";

/**
 * Turn the Page, in the order Todd's skill gives it: walk the trail, gather the season (shown here
 * for approval before anything is written), then the fresh page and the letting go.
 *
 * Nothing is written until the person presses "Turn the page". The summary lives only in this page.
 */

type Stage = "intro" | "gathering" | "review" | "writing" | "done" | "failed";

export function TurnThePage() {
  const [stage, setStage] = useState<Stage>("intro");
  const [summary, setSummary] = useState<TurnSummary | null>(null);
  const [conversations, setConversations] = useState(0);
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");

  async function post(payload: Record<string, unknown>) {
    const response = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof body.error === "string" ? body.error : "Something went wrong. Nothing has changed — try again in a moment.");
    }
    return body;
  }

  async function gather() {
    setStage("gathering");
    try {
      const body = await post({ action: "propose" });
      setSummary(body.summary as TurnSummary);
      setConversations(typeof body.conversations === "number" ? body.conversations : 0);
      setStage("review");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "");
      setStage("failed");
    }
  }

  async function turn() {
    if (!summary) return;
    setStage("writing");
    try {
      const body = await post({
        action: "commit",
        summary,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setTitle(typeof body.title === "string" ? body.title : "");
      setStage("done");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "");
      setStage("failed");
    }
  }

  if (stage === "intro") {
    return (
      <Shell title="Turn the page?">
        <p className="text-ink-soft">
          Growth you can&rsquo;t see back over isn&rsquo;t growth yet. I can read back through the conversations
          you&rsquo;ve kept in your EchoMap, gather that stretch into one short page, and begin a fresh EchoHub
          from there.
        </p>
        <p className="text-ink-soft">
          Nothing is deleted. Your current EchoHub stays exactly as it is. You&rsquo;ll read the page first, and
          nothing is written until you say so.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Primary onClick={gather}>Gather my season</Primary>
          <Secondary href="/chat">Not now</Secondary>
        </div>
      </Shell>
    );
  }

  if (stage === "gathering") {
    return (
      <Shell title="Reading back through the trail">
        <EchoLoader label="This takes a moment. Nothing has been changed." />
      </Shell>
    );
  }

  if (stage === "review" && summary) {
    return (
      <Shell title="Here is your season">
        <p className="text-ink-soft">
          From {conversations} conversations. This page can stand on its own, so if you ever let the older
          entries go, it still holds the trail.
        </p>
        <article className="echo-rise flex flex-col gap-4 rounded-xl border border-line bg-raised px-5 py-5 text-base leading-relaxed">
          <Field label="Theme of the season" text={summary.theme} />
          <List label="The trail, in brief" lines={summary.trail} />
          <Field label="What moved" text={summary.moved} />
          <Field label="What’s still carried" text={summary.carried} />
          <List label="Words worth keeping" lines={summary.words.map((line) => `“${line}”`)} />
          <Field label="A light for the next stretch" text={summary.light} />
          <Field label="Echo Thread" text={summary.thread} />
          <p className="text-sm text-ink-soft">
            <strong className="font-medium">My Reflection:</strong> <em>(yours to write, whenever you want)</em>
          </p>
        </article>
        <p className="text-xs leading-relaxed text-ink-soft">
          Turning the page starts a new EchoHub in your xTiles, beginning with this page, and your next
          conversations are kept there. Your current EchoHub, with every entry, stays as it is.
        </p>
        <div className="mt-2 flex flex-wrap gap-3">
          <Primary onClick={turn}>Turn the page</Primary>
          <Secondary href="/chat">Not yet</Secondary>
        </div>
      </Shell>
    );
  }

  if (stage === "writing") {
    return (
      <Shell title="Starting your next EchoHub">
        <EchoLoader label="Your current EchoHub is not being changed." />
      </Shell>
    );
  }

  if (stage === "done") {
    return (
      <Shell title="The page is turned">
        <p className="text-ink-soft">
          {title ? `“${title}” is now in your xTiles, beginning with this page.` : "Your next EchoHub is now in your xTiles, beginning with this page."}{" "}
          Your next conversations are kept there.
        </p>
        <p className="text-lg leading-relaxed">New page. Who are you now? Take your time.</p>
        <p className="text-ink-soft">
          When you want to, you can answer your EchoCompass again in xTiles, in your own words. If you had
          answered it before, those words are carried over there, and it&rsquo;s yours to rewrite.
        </p>
        <p className="text-ink-soft">
          This page now holds that stretch. If any of the older entries feel finished, you&rsquo;re free to let
          them go. That&rsquo;s your hand, not mine.
        </p>
        <div className="mt-2">
          <Secondary href="/chat" primary>
            Back to the conversation
          </Secondary>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title="That didn&rsquo;t work">
      <p className="rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-ink">
        {message}
      </p>
      <div className="flex flex-wrap gap-3">
        <Primary onClick={summary ? turn : gather}>Try again</Primary>
        <Secondary href="/chat">Back to the conversation</Secondary>
      </div>
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-4 px-5 py-14">
      <h1 className="text-2xl font-medium tracking-tight">{title}</h1>
      {children}
    </main>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  if (text.length === 0) return null;
  return (
    <p>
      <strong className="font-medium">{label}:</strong> {text}
    </p>
  );
}

function List({ label, lines }: { label: string; lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <strong className="font-medium">{label}:</strong>
      <ul className="mt-1 list-disc pl-5">
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function Primary({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="rounded-full bg-accent px-6 py-2.5 text-base font-medium text-on-accent fx-primary">
      {children}
    </button>
  );
}

function Secondary({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return (
    <a
      href={href}
      className={
        primary
          ? "inline-block rounded-full bg-accent px-6 py-2.5 text-base font-medium text-on-accent fx-primary"
          : "inline-block rounded-full px-6 py-2.5 text-base fx-soft"
      }
    >
      {children}
    </a>
  );
}
