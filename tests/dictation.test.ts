import { describe, expect, it } from "vitest";

import { isPlausibleTidy, joinDictation } from "@/lib/echo/dictation";

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
