"use client";

import { useEffect, useRef } from "react";

import type { LiveSpeech } from "@/components/chat/useSpeechInput";

/** A small meter beside the words: just enough to show the voice is being heard. */
const BARS = 12;
/** The band speech lives in. Bars are spread across it on a log scale, because
    that is how pitch is heard: equal steps in octaves, not in hertz. */
const LOW_HZ = 100;
const HIGH_HZ = 4000;

/**
 * The message bar, while someone is speaking. It shows their words as they
 * arrive: words the browser has settled on in full colour, words it is still
 * working out in a lighter one, and those lighter words change in place until
 * they settle. A small level meter on the right moves with the voice. When they
 * stop, the text box comes back with the words in it.
 *
 * The level comes from an AnalyserNode, which only measures loudness per
 * frequency; no audio is kept. Without one (phones, or the browser refused) the
 * bars idle gently instead, which says "listening" without claiming to follow
 * the voice.
 */
export function VoiceEqualizer({
  analyser,
  live,
}: {
  analyser: AnalyserNode | null;
  live: LiveSpeech | null;
}) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const words = useRef<HTMLDivElement>(null);

  // Keep the newest words in view when there are many.
  useEffect(() => {
    const element = words.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [live]);

  useEffect(() => {
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const smoothed = new Float32Array(BARS);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    // Which slice of the spectrum each bar listens to.
    const ranges = Array.from({ length: BARS }, (_, i) => {
      const from = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (i / BARS);
      const to = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((i + 1) / BARS);
      const lo = Math.max(1, Math.round(from / binHz));
      return { lo, hi: Math.max(lo + 1, Math.round(to / binHz)) };
    });
    let frame = 0;

    const draw = () => {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < BARS; i += 1) {
        const { lo, hi } = ranges[i]!;
        let sum = 0;
        for (let bin = lo; bin < hi; bin += 1) sum += data[bin] ?? 0;
        // Speech has far more energy low down than high up; tilt the bars so the
        // whole row responds to a voice instead of only its left end.
        const level = Math.min(1, ((sum / (hi - lo)) / 255) * (0.9 + (1.6 * i) / BARS));
        // Rise fast, fall slowly, so it moves like a level meter, not a flicker.
        smoothed[i] = Math.max(level, (smoothed[i] ?? 0) * 0.82);
        const bar = bars.current[i];
        if (bar) bar.style.transform = `scaleY(${(0.12 + 0.88 * (smoothed[i] ?? 0)).toFixed(3)})`;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser]);

  const empty = !live || `${live.before}${live.final}${live.interim}`.trim().length === 0;

  return (
    <div
      role="status"
      aria-label="Listening to your voice"
      className="echo-rise flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-accent bg-raised py-2 pl-4 pr-4"
    >
      {/* The words are not announced as they change; they are in the message box
          when listening stops, which is where a screen reader will find them. */}
      <div
        ref={words}
        aria-live="off"
        className="max-h-44 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap text-base leading-relaxed"
      >
        {empty || !live ? (
          <span className="text-ink-soft">Listening…</span>
        ) : (
          <>
            <span>
              {live.before}
              {live.final}
            </span>
            <span className="text-ink-soft">{live.interim}</span>
          </>
        )}
      </div>
      <div aria-hidden="true" className="flex h-6 shrink-0 items-center gap-[3px]">
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            ref={(element) => {
              bars.current[i] = element;
            }}
            // Half the bars on a narrow screen, so the words keep their room.
            className={`h-6 w-[3px] shrink-0 rounded-full bg-accent ${
              i >= BARS / 2 ? "hidden sm:block" : ""
            } ${analyser ? "" : "echo-eq-idle"}`}
            style={{
              transform: "scaleY(0.12)",
              animationDelay: analyser ? undefined : `${(i % 8) * 110}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
