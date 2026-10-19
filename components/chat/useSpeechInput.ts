"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Speech to text, using the browser's own speech recognition.
 *
 * What this is NOT: it is not a recording feature. EchoMe never captures, keeps
 * or sends audio. The browser's speech service turns the voice into words and
 * hands us only the words. While the person speaks they are shown live in the
 * message bar (words the browser is still unsure of appear lighter, then firm
 * up); when listening stops they are written into the message box, where the
 * person reads them, edits them, and chooses to send.
 *
 * Listening stops by itself after a few seconds of quiet, or when the person
 * taps the microphone again. Either way the box is filled in at once, and any
 * last words the browser delivers a moment later are added if it hasn't been
 * edited in the meantime.
 *
 * What the person should know, and the interface says so while it listens: that
 * speech service belongs to the browser's maker (Google for Chrome, Apple for
 * Safari), not to EchoMe, and the audio goes to it under its own terms.
 *
 * Alongside the recognizer, the microphone level is read (never recorded) so
 * the bar can draw a live level meter. That level only ever drives an animation.
 *
 * Nothing the person says is logged, stored or reported from here. Errors are
 * mapped from the browser's error CODE only.
 */

/** How long it can be quiet before listening stops by itself. */
export const SILENCE_STOP_SECONDS = 5;
const SILENCE_STOP_MS = SILENCE_STOP_SECONDS * 1000;

// The DOM typings in TypeScript do not include the recognition classes (they
// are still vendor-prefixed in Chrome and Safari), so the small part we use is
// described here instead of reaching for `any`.
interface Alternative {
  readonly transcript: string;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly [index: number]: Alternative | undefined;
}
interface ResultsEvent {
  readonly results: {
    readonly length: number;
    readonly [index: number]: RecognitionResult | undefined;
  };
}
interface ErrorEvent {
  readonly error: string;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: ResultsEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  // window has no typed member for either spelling, hence the cast through unknown.
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

/** What to tell the person for each error code the browser can report. */
function messageFor(code: string): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "The microphone is blocked. Allow it in your browser's site settings, then try again.";
    case "no-speech":
      return "Nothing was heard. Tap the microphone and try again, or type instead.";
    case "audio-capture":
      return "No microphone was found. Check that one is connected, or type instead.";
    case "network":
      return "Your browser's speech service couldn't be reached. Check your connection, or type instead.";
    case "aborted":
      return null; // We stopped it ourselves.
    default:
      return "Voice input stopped. You can tap the microphone to try again, or type instead.";
  }
}

/** The microphone, opened only to read how loud it is. */
interface Meter {
  readonly stream: MediaStream;
  readonly context: AudioContext;
}

/** What the message bar shows while someone is speaking. */
export interface LiveSpeech {
  /** What was already typed in the box before they started. */
  readonly before: string;
  /** Words the browser has settled on. */
  readonly final: string;
  /** Words it is still working out; these can change. */
  readonly interim: string;
}

export function useSpeechInput(getTextarea: () => HTMLTextAreaElement | null) {
  // False on the server and on first paint, so the button only appears once we
  // know this browser can do it. Firefox, for one, cannot.
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Live microphone level, for the level meter. Null when it isn't available. */
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  /** The words as they arrive. Null when not listening. */
  const [live, setLive] = useState<LiveSpeech | null>(null);

  /** The recognizer still attached: listening, or finishing its last words. */
  const active = useRef<Recognition | null>(null);
  /** Ends the current listening session; null when nothing is listening. */
  const finisher = useRef<(() => void) | null>(null);
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const meter = useRef<Meter | null>(null);
  /** Bumped whenever a listening session ends, so a slow microphone request
      that finishes late knows it is no longer wanted. */
  const session = useRef(0);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current);
    silenceTimer.current = null;
  }, []);

  const closeMeter = useCallback(() => {
    const open = meter.current;
    meter.current = null;
    setAnalyser(null);
    if (!open) return;
    for (const track of open.stream.getTracks()) track.stop();
    void open.context.close().catch(() => {});
  }, []);

  const detach = useCallback((recognition: Recognition | null) => {
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      // Already stopped.
    }
  }, []);

  /** Stop at once and drop anything still in flight. Nothing is written. */
  const abort = useCallback(() => {
    session.current += 1;
    clearSilenceTimer();
    detach(active.current);
    active.current = null;
    finisher.current = null;
    closeMeter();
    setListening(false);
    setLive(null);
  }, [clearSilenceTimer, closeMeter, detach]);

  useEffect(() => {
    setSupported(recognitionConstructor() !== null);
    return abort;
  }, [abort]);

  /**
   * Open the microphone just to read its level. Skipped on touch devices: phones
   * generally let only one thing use the microphone at a time, and a level meter
   * is not worth risking the dictation itself. There the bars idle instead.
   * If anything about this fails, dictation carries on without it.
   */
  const startMeter = useCallback(async (id: number) => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (session.current !== id) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const Context =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const context = new Context();
      // Some browsers start an audio context paused; without this the bars
      // would sit flat even while someone is talking.
      void context.resume().catch(() => {});
      const node = context.createAnalyser();
      node.fftSize = 1024;
      node.smoothingTimeConstant = 0.7;
      context.createMediaStreamSource(stream).connect(node);
      meter.current = { stream, context };
      setAnalyser(node);
    } catch {
      // No meter. The recognizer is unaffected.
    }
  }, []);

  const start = useCallback(() => {
    const Recognition = recognitionConstructor();
    const textarea = getTextarea();
    if (!Recognition || !textarea) return;

    // A session that is still finishing its last words is let go.
    detach(active.current);
    active.current = null;
    clearSilenceTimer();

    setError(null);
    session.current += 1;
    const id = session.current;

    // What was typed before, shown first in the bar and kept in front of the words.
    const typed = textarea.value;
    const before = typed.length > 0 && !/\s$/.test(typed) ? `${typed} ` : typed;

    // Held in memory. Never written anywhere but the message box.
    let finalText = "";
    let interimText = "";
    let finished = false;
    /** What we last put in the box, so a later update only happens if it's untouched. */
    let written: string | null = null;
    let prefix = "";

    const writeToBox = () => {
      if (written === null) prefix = textarea.value;
      else if (textarea.value !== written) return; // They edited it: leave it alone.
      const spoken = `${finalText}${interimText}`.trim();
      if (spoken.length === 0) return;
      const gap = prefix.length > 0 && !/\s$/.test(prefix) ? " " : "";
      written = `${prefix}${gap}${spoken}`;
      textarea.value = written;
      textarea.setSelectionRange(written.length, written.length);
    };

    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    /** Stop listening NOW: the box is filled in and the bar goes away at once,
        without waiting for the browser to wrap up. */
    const finish = () => {
      if (finished) return;
      finished = true;
      if (finisher.current === finish) finisher.current = null;
      clearSilenceTimer();
      session.current += 1;
      closeMeter();
      setListening(false);
      setLive(null);
      writeToBox();
      try {
        recognition.stop();
      } catch {
        // Already stopped.
      }
    };

    const armSilenceTimer = () => {
      clearSilenceTimer();
      silenceTimer.current = setTimeout(finish, SILENCE_STOP_MS);
    };

    recognition.onresult = (event) => {
      // Rebuilt from the full list each time, so words firm up in place as the
      // browser revises its guess instead of piling up as duplicates.
      let settled = "";
      let unsettled = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? "";
        if (result?.isFinal) settled += text;
        else unsettled += text;
      }
      finalText = settled;
      interimText = unsettled;

      if (finished) {
        // The browser's last words, arriving just after we stopped.
        writeToBox();
        return;
      }
      setLive({
        before,
        final: settled.trimStart(),
        interim: settled.length === 0 ? unsettled.trimStart() : unsettled,
      });
      armSilenceTimer();
    };
    recognition.onerror = (event) => setError(messageFor(event.error));
    recognition.onend = () => {
      // The browser ended it (or we asked it to): make sure it is finished, then let go.
      finish();
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      if (active.current === recognition) active.current = null;
    };

    active.current = recognition;
    finisher.current = finish;
    setListening(true);
    setLive({ before, final: "", interim: "" });
    armSilenceTimer();
    try {
      recognition.start();
    } catch {
      // Starting twice in a row throws in some browsers.
      clearSilenceTimer();
      active.current = null;
      finisher.current = null;
      setListening(false);
      setLive(null);
      return;
    }
    void startMeter(id);
  }, [getTextarea, clearSilenceTimer, closeMeter, detach, startMeter]);

  /** Tap to start; tap again to stop. */
  const toggle = useCallback(() => {
    if (finisher.current) finisher.current();
    else start();
  }, [start]);

  return { supported, listening, error, analyser, live, toggle, abort };
}
