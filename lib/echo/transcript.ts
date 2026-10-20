import type Anthropic from "@anthropic-ai/sdk";

/**
 * The in-memory shape of a conversation, and the only thing that ever gets
 * encrypted into live_sessions.encrypted_payload.
 *
 * Messages are stored as the SDK's own MessageParam, including assistant
 * thinking blocks with their signatures, so a resumed session replays back to
 * the API byte-identically to how it came out.
 */

export const TRANSCRIPT_VERSION = 1;

export interface Transcript {
  readonly v: number;
  readonly messages: Anthropic.Beta.BetaMessageParam[];
  /**
   * What the person keeps in their own xTiles (EchoCompass and EchoMap), read
   * once when this conversation began. "" means "looked, nothing there"; absent
   * means "not looked yet". It lives only inside the encrypted session payload,
   * so it is destroyed with the conversation like everything else here.
   */
  readonly memory?: string;
}

export function emptyTranscript(): Transcript {
  return { v: TRANSCRIPT_VERSION, messages: [] };
}

export class TranscriptFormatError extends Error {
  override readonly name = "TranscriptFormatError";
}

export function serialiseTranscript(transcript: Transcript): string {
  return JSON.stringify(transcript);
}

/**
 * Parse a decrypted payload. Validates shape only — never inspects, logs or
 * reports message content, and the error carries none of it.
 */
export function deserialiseTranscript(plaintext: string): Transcript {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new TranscriptFormatError("Session payload is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new TranscriptFormatError("Session payload is not an object.");
  }
  const candidate = parsed as { v?: unknown; messages?: unknown; memory?: unknown };
  if (candidate.v !== TRANSCRIPT_VERSION) {
    throw new TranscriptFormatError(`Unsupported transcript version: ${String(candidate.v)}`);
  }
  if (!Array.isArray(candidate.messages)) {
    throw new TranscriptFormatError("Session payload has no message array.");
  }
  return {
    v: TRANSCRIPT_VERSION,
    messages: candidate.messages as Anthropic.Beta.BetaMessageParam[],
    ...(typeof candidate.memory === "string" ? { memory: candidate.memory } : {}),
  };
}

export function withMessages(
  transcript: Transcript,
  ...added: Anthropic.Beta.BetaMessageParam[]
): Transcript {
  // Spread first so anything else the transcript carries (its memory) survives.
  return { ...transcript, v: TRANSCRIPT_VERSION, messages: [...transcript.messages, ...added] };
}

/** What the browser needs to render a resumed conversation. */
export interface DisplayTurn {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

/**
 * Flatten a transcript for display. Thinking and redacted_thinking blocks are
 * dropped: they are kept in history for the API's benefit, never shown.
 */
export function toDisplayTurns(transcript: Transcript): DisplayTurn[] {
  const turns: DisplayTurn[] = [];
  transcript.messages.forEach((message, index) => {
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => (block as Anthropic.Beta.BetaTextBlockParam).text)
            .join("");
    if (text.length === 0) return;
    // MessageParam.role also admits "system" in this SDK. We never write one,
    // and if one ever appeared it is not the user's conversation, so skip it.
    if (message.role !== "user" && message.role !== "assistant") return;
    turns.push({ id: `turn-${index}`, role: message.role, text });
  });
  return turns;
}
