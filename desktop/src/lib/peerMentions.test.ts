import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveMentions } from "./peerMentions";

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
});
