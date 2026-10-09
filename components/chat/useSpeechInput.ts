"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Speech to text, using the browser's own speech recognition.
 *
 * What this is NOT: it is not a recording feature. EchoMe never captures, keeps
 * or sends audio. The browser's speech service turns the voice into words and
 * hands us only the words. They are held in memory while the person speaks and
 * pasted into the message box when they stop — the person reads them, edits
 * them, and chooses to send.
 *
 * What the person should know, and the interface says so while it listens: that
 * speech service belongs to the browser's maker (Google for Chrome, Apple for
 * Safari), not to EchoMe, and the audio goes to it under its own terms.
 *
 * Alongside the recognizer, the microphone level is read (never recorded) so
 * the chat can draw a live equalizer. That level only ever drives an animation.
 *
 * Nothing the person says is logged, stored or reported from here. Errors are
 * mapped from the browser's error CODE only.
 */

// The DOM typings in TypeScript do not include the recognition classes (they
// are still vendor-prefixed in Chrome and Safari), so the small part we use is
// described here instead of reaching for `any`.
interface Alternative {
  readonly transcript: string;
}
interface RecognitionResult {
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

export function useSpeechInput(getTextarea: () => HTMLTextAreaElement | null) {
  // False on the server and on first paint, so the button only appears once we
  // know this browser can do it. Firefox, for one, cannot.
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Live microphone level, for the equalizer. Null when it isn't available. */
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const active = useRef<Recognition | null>(null);
  const meter = useRef<Meter | null>(null);
  /** Bumped whenever a listening session ends, so a slow microphone request
      that finishes late knows it is no longer wanted. */
  const session = useRef(0);

  const closeMeter = useCallback(() => {
    const open = meter.current;
    meter.current = null;
    setAnalyser(null);
    if (!open) return;
    for (const track of open.stream.getTracks()) track.stop();
    void open.context.close().catch(() => {});
  }, []);

  /** Stop at once and drop anything still in flight. Nothing is pasted. */
  const abort = useCallback(() => {
    session.current += 1;
    const current = active.current;
    if (current) {
      current.onresult = null;
      current.onerror = null;
      current.onend = null;
      try {
        current.abort();
      } catch {
        // Already stopped.
      }
      active.current = null;
    }
    closeMeter();
    setListening(false);
  }, [closeMeter]);

  useEffect(() => {
    setSupported(recognitionConstructor() !== null);
    return abort;
  }, [abort]);

  /**
   * Open the microphone just to read its level. Skipped on touch devices: phones
   * generally let only one thing use the microphone at a time, and an equalizer
   * is not worth risking the dictation itself. There the bars idle instead.
   * If anything about this fails, dictation carries on without it.
   */
  const startMeter = useCallback(
    async (id: number) => {
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
    },
    [],
  );

  const start = useCallback(() => {
    const Recognition = recognitionConstructor();
    const textarea = getTextarea();
    if (!Recognition || !textarea) return;

    setError(null);
    session.current += 1;
    const id = session.current;

    // Held in memory until they stop. Never written anywhere else.
    let heard = "";

    const recognition = new Recognition();
    recognition.lang = navigator.language || "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      // Rebuilt from the full list each time, so words firm up in place as the
      // browser revises its guess instead of piling up as duplicates.
      let text = "";
      for (let i = 0; i < event.results.length; i += 1) {
        text += event.results[i]?.[0]?.transcript ?? "";
      }
      heard = text;
    };
    recognition.onerror = (event) => setError(messageFor(event.error));
    recognition.onend = () => {
      active.current = null;
      session.current += 1;
      closeMeter();
      setListening(false);

      // They stopped (or the browser ended it): put what was heard in the box,
      // after whatever is there NOW, so anything typed meanwhile is kept.
      const words = heard.trim();
      if (words.length === 0) return;
      const typed = textarea.value;
      const gap = typed.length > 0 && !/\s$/.test(typed) ? " " : "";
      textarea.value = `${typed}${gap}${words}`;
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      // On a phone, focusing would pop the keyboard up over what they just said.
      if (!window.matchMedia("(pointer: coarse)").matches) textarea.focus();
    };

    active.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      // Starting twice in a row throws in some browsers.
      active.current = null;
      setListening(false);
      return;
    }
    void startMeter(id);
  }, [getTextarea, closeMeter, startMeter]);

  /** Ask the browser to finish what it is hearing; the words arrive on end. */
  const toggle = useCallback(() => {
    if (active.current) active.current.stop();
    else start();
  }, [start]);

  return { supported, listening, error, analyser, toggle, abort };
}
