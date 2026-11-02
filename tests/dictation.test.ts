import { describe, expect, it } from "vitest";

import { isPlausibleTidy, joinDictation, mergeSpeech } from "@/lib/echo/dictation";

describe("joining spoken words onto what is already in the box", () => {
  it("starts a new message with a capital", () => {
    expect(joinDictation("", "i have been thinking")).toBe("I have been thinking");
    expect(joinDictation("   ", "today was long")).toBe("Today was long");
  });

  it("begins a new sentence after a finished one", () => {
    expect(joinDictation("I was tired.", "today was long")).toBe("I was tired. Today was long");
    expect(joinDictation("Was that fair?", "maybe not")).toBe("Was that fair? Maybe not");
    expect(joinDictation('She said "no."', "and I left")).toBe('She said "no." And I left');
  });

  it("carries on in lower case from an unfinished sentence", () => {
    expect(joinDictation("I keep coming back to", "The way she looked at me")).toBe(
      "I keep coming back to the way she looked at me",
    );
    expect(joinDictation("I was angry, ", "But I said nothing")).toBe("I was angry, but I said nothing");
  });

  it("keeps I, and anything that could be a name, as the recogniser wrote it", () => {
    expect(joinDictation("Yesterday", "I'm not sure")).toBe("Yesterday I'm not sure");
    expect(joinDictation("I talked to", "Todd about it")).toBe("I talked to Todd about it");
    expect(joinDictation("It reminded me of", "Chicago")).toBe("It reminded me of Chicago");
  });

  it("uses a single space, whatever was at the end of the box", () => {
    expect(joinDictation("so I went   ", "to the park")).toBe("so I went to the park");
    expect(joinDictation("so I went", "  to   the   park ")).toBe("so I went to the park");
  });

  it("keeps a line break that was already there, and starts the new line with a capital", () => {
    expect(joinDictation("First thought\n", "second thought")).toBe("First thought\nSecond thought");
    expect(joinDictation("First thought\n\n", "second thought")).toBe("First thought\n\nSecond thought");
  });

  it("puts punctuation the browser spoke straight onto the words before it", () => {
    expect(joinDictation("I was tired", ", but fine")).toBe("I was tired, but fine");
    expect(joinDictation("I was tired", ".")).toBe("I was tired.");
  });

  it("never changes what was already written", () => {
    const written = "my  own   spacing, and Odd Capitals";
    expect(joinDictation(written, "more words").startsWith(written)).toBe(true);
  });

  it("returns the box as it was when nothing was said", () => {
    expect(joinDictation("keep this ", "   ")).toBe("keep this ");
  });
});

describe("is this a tidy-up of the same words?", () => {
  const spoken = "i went to see there mother yesterday and she was not well";

  it("accepts light fixes: punctuation, capitals, a homophone", () => {
    expect(isPlausibleTidy(spoken, "I went to see their mother yesterday, and she was not well.")).toBe(true);
    expect(isPlausibleTidy(spoken, spoken)).toBe(true);
  });

  it("refuses an answer, a summary or commentary", () => {
    expect(isPlausibleTidy(spoken, "I'm sorry to hear that. Would you like to talk about her health?")).toBe(false);
    expect(isPlausibleTidy(spoken, "Went to see mother.")).toBe(false);
    expect(isPlausibleTidy(spoken, `Here is the corrected text: ${spoken}. Let me know if you need anything else.`)).toBe(false);
  });

  it("refuses an empty result", () => {
    expect(isPlausibleTidy(spoken, "")).toBe(false);
    expect(isPlausibleTidy("", "anything")).toBe(false);
  });
});

describe("merging what the browser's speech recognition returns", () => {
  it("says a phrase once when the browser sends it again and again, a little longer each time", () => {
    // Chrome on Android sends growing copies, each marked final.
    expect(mergeSpeech(["the", "the weather", "the weather is", "the weather is lovely"])).toBe(
      "the weather is lovely",
    );
    expect(mergeSpeech(["The weather is", " The weather is lovely today"])).toBe("The weather is lovely today");
  });

  it("leaves separate phrases as they are, in order", () => {
    expect(mergeSpeech(["It was a long day", " and then it rained"])).toBe("It was a long day and then it rained");
    expect(mergeSpeech(["Hello there.", " How are you?"])).toBe("Hello there. How are you?");
  });

  it("does not mind a changed capital or punctuation between copies", () => {
    expect(mergeSpeech(["the weather", "The weather is, lovely"])).toBe("The weather is, lovely");
  });

  it("adds only what is new when a part picks up partway through the last words", () => {
    expect(mergeSpeech(["we went to the park", "to the park and then home"])).toBe(
      "we went to the park and then home",
    );
  });

  it("ignores a longer phrase repeated as a copy of what is already there", () => {
    expect(mergeSpeech(["the weather is lovely", "the weather is lovely"])).toBe("the weather is lovely");
    expect(mergeSpeech(["the weather is lovely today", "the weather is lovely"])).toBe(
      "the weather is lovely today",
    );
  });

  it("does not swallow a word that was really said twice", () => {
    expect(mergeSpeech(["I said no", "no"])).toBe("I said no no");
  });

  it("keeps a single word that is said again after a pause", () => {
    expect(mergeSpeech(["yes", " yes"])).toBe("yes yes");
    expect(mergeSpeech(["no", " no", " no"])).toBe("no no no");
  });

  it("never adds, drops or reorders a word, whatever the browser's pattern (randomised)", () => {
    // A small seeded generator, so a failure can be reproduced.
    let seed = 20261102;
    const random = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const vocabulary = Array.from({ length: 60 }, (_, i) => `w${i.toString(36)}x`);

    for (let round = 0; round < 400; round += 1) {
      const count = 2 + Math.floor(random() * 25);
      const words = Array.from({ length: count }, () => vocabulary[Math.floor(random() * vocabulary.length)]!);
      // Keep the sentence free of accidental repeats, so a repeat in the output can only be a bug.
      const sentence = [...new Set(words)];
      const want = sentence.join(" ");

      // Chrome on Android: each result is a longer copy of the same sentence.
      const growing: string[] = [];
      for (let end = 1; end <= sentence.length; end += 1 + Math.floor(random() * 3)) {
        growing.push(sentence.slice(0, end).join(" "));
      }
      growing.push(want);
      expect(mergeSpeech(growing)).toBe(want);

      // The same, with the browser sending the last copy again and with odd spacing.
      expect(mergeSpeech([...growing, ` ${want}`, want])).toBe(want);

      // Most browsers: the sentence in separate phrases, each once.
      const phrases: string[] = [];
      for (let at = 0; at < sentence.length; ) {
        const take = 1 + Math.floor(random() * 5);
        phrases.push(sentence.slice(at, at + take).join(" "));
        at += take;
      }
      expect(mergeSpeech(phrases)).toBe(want);
    }
  });

  it("handles nothing at all", () => {
    expect(mergeSpeech([])).toBe("");
    expect(mergeSpeech(["", "  "])).toBe("");
  });
});
