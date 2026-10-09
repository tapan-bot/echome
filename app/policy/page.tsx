import { AuthLink } from "@/components/auth/fields";

/**
 * A plain-language description of what actually happens to what someone
 * writes here — grounded in the real erasure model (live_sessions.payload,
 * encrypted, key destroyed on close), not boilerplate. Draft wording; final
 * copy is the client's to confirm before this is treated as a legal policy.
 */
export const dynamic = "force-dynamic";

export default function PolicyPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 px-5 py-14">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">How EchoMe handles your data</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Plain language, describing what the software actually does — not a substitute for the
          final legal terms.
        </p>
      </div>

      <Section title="Your conversation is never stored as readable text">
        While a conversation is open, it lives in one encrypted record, locked with a key that
        belongs to that conversation alone. Nobody — including us — can read it by looking at the
        database. When you end the conversation, that key is destroyed. There is no backup copy,
        no log, and no way to recover it afterward. That deletion is permanent by design.
      </Section>

      <Section title="What you choose to keep">
        When you end a conversation, EchoMe offers a short, distilled summary of what stood out —
        never a transcript. You choose which parts, if any, to keep. Anything you keep is written
        to your own xTiles workspace, which belongs to you, not to us. Anything you don&rsquo;t
        keep is destroyed along with everything else.
      </Section>

      <Section title="What we don't do">
        We don&rsquo;t log the content of what you write — not for debugging, not for analytics,
        not temporarily. Telemetry we do keep is limited to things like response times, token
        counts, and error types: never the words themselves.
      </Section>

      <Section title="Voice input">
        If you use the microphone button, your browser &mdash; not EchoMe &mdash; turns your voice
        into text, using a speech service run by the browser&rsquo;s maker (for example Google for
        Chrome, Apple for Safari). Your audio goes to that service under its own privacy terms.
        EchoMe never receives or records audio; it only receives the words, which are then treated
        like anything else you write. If you&rsquo;d rather not, just type.
      </Section>

      <Section title="Account and billing">
        Signing in is handled by Supabase; payment, if you choose a paid plan, is handled by
        Stripe. We don&rsquo;t see or store your card details ourselves. Account emails (like a
        password reset link) are sent through Resend.
      </Section>

      <Section title="Questions">
        If something here is unclear, or you want a conversation&rsquo;s data removed sooner than
        it otherwise would be, reach out and we&rsquo;ll help.
      </Section>

      <p className="text-sm">
        <AuthLink href="/welcome">Back to EchoMe</AuthLink>
      </p>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-6">
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-sm leading-relaxed text-ink-soft">{children}</p>
    </section>
  );
}
