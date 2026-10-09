"use client";

import { useEffect, useRef } from "react";

const BARS = 24;
/** The band speech lives in. Bars are spread across it on a log scale, because
    that is how pitch is heard: equal steps in octaves, not in hertz. */
const LOW_HZ = 100;
const HIGH_HZ = 4000;

/**
 * A bubble on the sender's side of the thread that shows the voice being heard:
 * a row of bars that rise and fall with the microphone level while someone
 * speaks. It is the same place a sent message would land, so it reads as
 * "your words are coming".
 *
 * The level comes from an AnalyserNode, which only measures loudness per
 * frequency; no audio is kept. Without one (phones, or the browser refused) the
 * bars idle gently instead, which says "listening" without claiming to follow
 * the voice.
 */
export function VoiceEqualizer({ analyser }: { analyser: AnalyserNode | null }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);

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

  return (
    <div className="echo-rise flex justify-end">
      <div
        role="status"
        aria-label="Listening to your voice"
        className="flex h-12 items-center gap-[3px] rounded-3xl rounded-br-lg bg-raised px-5 shadow-sm ring-1 ring-line"
      >
        {Array.from({ length: BARS }, (_, i) => (
          <span
            key={i}
            ref={(element) => {
              bars.current[i] = element;
            }}
            aria-hidden="true"
            className={`h-6 w-[3px] rounded-full bg-accent ${analyser ? "" : "echo-eq-idle"}`}
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
