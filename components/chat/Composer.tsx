"use client";

import { useCallback, useEffect, useRef, type FormEvent, type KeyboardEvent } from "react";

import { useSpeechInput } from "@/components/chat/useSpeechInput";

interface ComposerProps {
  readonly disabled: boolean;
  readonly onSend: (text: string) => void;
  /** Told when dictation starts or stops, so the thread can show the equalizer. */
  readonly onVoiceChange?: (voice: { analyser: AnalyserNode | null } | null) => void;
}

export function Composer({ disabled, onSend, onVoiceChange }: ComposerProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const getTextarea = useCallback(() => textarea.current, []);
  const speech = useSpeechInput(getTextarea);

  const { listening, analyser } = speech;
  useEffect(() => {
    onVoiceChange?.(listening ? { analyser } : null);
  }, [listening, analyser, onVoiceChange]);

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const element = textarea.current;
    if (!element) return;
    const text = element.value.trim();
    if (text.length === 0 || disabled) return;
    // Stop listening BEFORE the box is cleared, or a late result would put the
    // words that were just sent straight back into it.
    speech.abort();
    element.value = "";
    // Nothing is written to localStorage here or anywhere else in this app. A
    // draft lives in this textarea and in this tab's memory, and nowhere else.
    onSend(text);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends on a physical keyboard; Shift+Enter makes a new line. On
    // touch keyboards Enter always makes a new line, because sending a half
    // finished thought by accident is worse than an extra tap.
    if (event.key !== "Enter" || event.shiftKey) return;
    if (window.matchMedia("(pointer: coarse)").matches) return;
    submit();
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2 border-t border-line bg-page px-4 pt-3"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      {speech.listening ? (
        <p role="status" className="text-xs leading-relaxed text-ink-soft">
          Listening… tap the microphone when you&rsquo;re done and your words will appear here. Your
          browser&rsquo;s own speech service turns your voice into words, and only the words come
          to EchoMe.
        </p>
      ) : speech.error ? (
        <p role="alert" className="text-xs leading-relaxed text-warn">
          {speech.error}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          ref={textarea}
          name="message"
          rows={1}
          onKeyDown={onKeyDown}
          placeholder="What's on your mind?"
          aria-label="Your message"
          className="max-h-48 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-raised px-4 py-2.5 text-base leading-relaxed outline-none transition focus:border-ink-soft"
        />
        {speech.supported ? (
          <button
            type="button"
            onClick={speech.toggle}
            disabled={disabled}
            aria-pressed={speech.listening}
            aria-label={speech.listening ? "Stop voice input" : "Start voice input"}
            className={`mb-0.5 flex size-10 shrink-0 items-center justify-center rounded-full border transition disabled:opacity-40 ${
              speech.listening
                ? "echo-breathe border-accent bg-accent text-on-accent"
                : "border-line text-ink-soft hover:border-accent hover:text-ink"
            }`}
          >
            <MicIcon />
          </button>
        ) : null}
        <button
          type="submit"
          disabled={disabled}
          className="mb-0.5 shrink-0 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-on-accent transition disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </form>
  );
}

function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </svg>
  );
}
