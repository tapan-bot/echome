"use client";

import { useEffect, useRef, useState } from "react";

/** The band speech lives in. Bars are spread across it on a log scale, because
    that is how pitch is heard: equal steps in octaves, not in hertz. */
const LOW_HZ = 100;
const HIGH_HZ = 4000;
/** One bar plus its gap, in pixels: used to fit as many bars as the width allows. */
const BAR_PITCH = 6;

/**
 * The message bar, while someone is speaking: a row of bars that rise and fall
 * with the microphone level, filling the same space the text box does. When
 * they stop, the text box comes back with their words in it.
 *
 * The level comes from an AnalyserNode, which only measures loudness per
 * frequency; no audio is kept. Without one (phones, or the browser refused) the
 * bars idle gently instead, which says "listening" without claiming to follow
 * the voice.
 */
export function VoiceEqualizer({ analyser }: { analyser: AnalyserNode | null }) {
  const container = useRef<HTMLDivElement>(null);
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const [count, setCount] = useState(32);

  // As many bars as fit, so the row fills the bar on a phone and on a desktop.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const fit = () =>
      setCount(Math.max(12, Math.min(96, Math.floor((element.clientWidth - 40) / BAR_PITCH))));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const smoothed = new Float32Array(count);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    // Which slice of the spectrum each bar listens to.
    const ranges = Array.from({ length: count }, (_, i) => {
      const from = LOW_HZ * (HIGH_HZ / LOW_HZ) ** (i / count);
      const to = LOW_HZ * (HIGH_HZ / LOW_HZ) ** ((i + 1) / count);
      const lo = Math.max(1, Math.round(from / binHz));
      return { lo, hi: Math.max(lo + 1, Math.round(to / binHz)) };
    });
    let frame = 0;

    const draw = () => {
      analyser.getByteFrequencyData(data);
      for (let i = 0; i < count; i += 1) {
        const { lo, hi } = ranges[i]!;
        let sum = 0;
        for (let bin = lo; bin < hi; bin += 1) sum += data[bin] ?? 0;
        // Speech has far more energy low down than high up; tilt the bars so the
        // whole row responds to a voice instead of only its left end.
        const level = Math.min(1, ((sum / (hi - lo)) / 255) * (0.9 + (1.6 * i) / count));
        // Rise fast, fall slowly, so it moves like a level meter, not a flicker.
        smoothed[i] = Math.max(level, (smoothed[i] ?? 0) * 0.82);
        const bar = bars.current[i];
        if (bar) bar.style.transform = `scaleY(${(0.12 + 0.88 * (smoothed[i] ?? 0)).toFixed(3)})`;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [analyser, count]);

  return (
    <div
      ref={container}
      role="status"
      aria-label="Listening to your voice"
      className="echo-rise flex h-11 min-w-0 flex-1 items-center justify-center gap-[3px] overflow-hidden rounded-2xl border border-accent bg-raised px-5"
    >
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          ref={(element) => {
            bars.current[i] = element;
          }}
          aria-hidden="true"
          className={`h-6 w-[3px] shrink-0 rounded-full bg-accent ${analyser ? "" : "echo-eq-idle"}`}
          style={{
            transform: "scaleY(0.12)",
            animationDelay: analyser ? undefined : `${(i % 8) * 110}ms`,
          }}
        />
      ))}
    </div>
  );
}
