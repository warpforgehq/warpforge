import { describe, expect, it } from "vitest";

import {
  formatElapsed,
  insertTranscript,
  pickInstalledModel,
  type DictationModel,
} from "./dictation";

function model(id: string, installed: boolean): DictationModel {
  return { id, label: id, description: "", sizeBytes: 1, installed, isDefault: false };
}

describe("insertTranscript", () => {
  it("inserts into an empty draft", () => {
    expect(insertTranscript("", 0, 0, " Привіт ")).toEqual({ value: "Привіт", caret: 6 });
  });

  it("pads with spaces between words", () => {
    expect(insertTranscript("hello world", 5, 5, "big")).toEqual({
      value: "hello big world",
      caret: 9,
    });
  });

  it("does not double existing spaces", () => {
    expect(insertTranscript("hello ", 6, 6, "there")).toEqual({
      value: "hello there",
      caret: 11,
    });
  });

  it("replaces the selection", () => {
    expect(insertTranscript("fix the bug now", 4, 11, "що")).toEqual({
      value: "fix що now",
      caret: 6,
    });
  });

  it("keeps punctuation attached to what follows", () => {
    expect(insertTranscript("Say , please", 3, 4, "commit").value).toBe("Say commit, please");
  });

  it("ignores an empty transcript", () => {
    expect(insertTranscript("draft", 2, 2, "  ")).toEqual({ value: "draft", caret: 2 });
  });
});

describe("pickInstalledModel", () => {
  it("prefers the chosen model when installed", () => {
    expect(pickInstalledModel([model("a", true), model("b", true)], "b")).toBe("b");
  });

  it("falls back to any installed model", () => {
    expect(pickInstalledModel([model("a", false), model("b", true)], "a")).toBe("b");
  });

  it("returns null with nothing installed", () => {
    expect(pickInstalledModel([model("a", false)], "a")).toBeNull();
  });
});

describe("formatElapsed", () => {
  it("formats minutes and seconds", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(65_400)).toBe("1:05");
  });
});
