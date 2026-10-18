import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { mentionSpans, resolveMentions } from "./peerMentions";

interface Vectors {
  candidates: { id: string; label: string }[];
  cases: { text: string; found?: string[]; ambiguous?: string[] }[];
}

const vectors = JSON.parse(
  readFileSync("../tests/fixtures/mention-vectors.json", "utf8"),
) as Vectors;

describe("resolveMentions", () => {
  it.each(vectors.cases.filter((c) => !c.ambiguous))(
    "resolves $text as the daemon does",
    ({ text, found }) => {
      const result = resolveMentions(text, vectors.candidates);
      expect(result.ambiguous).toBeNull();
      expect(result.found).toStrictEqual(found);
    },
  );

  it.each(vectors.cases.filter((c) => c.ambiguous))(
    "refuses $text as ambiguous, as the daemon does",
    ({ text, ambiguous }) => {
      expect(resolveMentions(text, vectors.candidates).ambiguous?.ids).toStrictEqual(ambiguous);
    },
  );

  it("lists the @words that name no session", () => {
    const result = resolveMentions("@Docz and @Fix, mail me@x", vectors.candidates);
    expect(result.unmatched).toStrictEqual(["@Docz"]);
    expect(result.found).toStrictEqual(["t_ab99ffff"]);
  });

  it("places each mention that names one session, and skips the rest", () => {
    const candidates = [
      { id: "t_ada00000", label: "Ada" },
      { id: "t_bo000000", label: "Bo" },
      { id: "t_bo111111", label: "Bo" },
    ];
    const spans = mentionSpans("hi @Ada, @Bo and @Zed 🙂 @ada", candidates);
    expect(spans.map(({ start, end, candidate }) => [start, end, candidate.id])).toStrictEqual([
      [3, 7, "t_ada00000"],
      [24, 28, "t_ada00000"],
    ]);
  });
});
