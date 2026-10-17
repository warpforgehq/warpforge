import { describe, expect, it } from "vitest";

import { applyName, applyVoice, voiceOf } from "./soulText";

const TEMPLATE =
  "# Smith\n\n## Voice\n\nPlain and direct.\n\n## Decision rules\n\n- Ask before anything you are unsure about.\n\n## Refusals\n\n- Nothing beyond the constitution yet.\n";

describe("applyVoice", () => {
  it("replaces only the voice section", () => {
    const soul = applyVoice(TEMPLATE, "Careful and thorough.");
    expect(voiceOf(soul)).toBe("Careful and thorough.");
    expect(soul).toContain("## Decision rules\n\n- Ask before anything you are unsure about.");
    expect(soul).toContain("## Refusals");
    expect(soul.startsWith("# Smith\n\n## Voice\n\nCareful and thorough.\n\n## Decision")).toBe(
      true,
    );
  });

  it("keeps the user's own edits outside the section", () => {
    const edited = TEMPLATE.replace("- Nothing beyond", "- Never force-push.\n- Nothing beyond");
    expect(applyVoice(edited, "Fast.")).toContain("- Never force-push.");
  });

  it("adds a voice section after the title when there is none", () => {
    expect(applyVoice("# Ada\n\n## Refusals\n\n- None.\n", "Jokes a lot.")).toBe(
      "# Ada\n\n## Voice\n\nJokes a lot.\n\n## Refusals\n\n- None.\n",
    );
  });

  it("treats a sub-heading inside the voice as part of it", () => {
    const soul = "# Ada\n\n## Voice\n\nOld.\n\n### Examples\n\n- hi\n\n## Refusals\n";
    expect(applyVoice(soul, "New.")).toBe("# Ada\n\n## Voice\n\nNew.\n\n## Refusals\n");
  });
});

describe("applyName", () => {
  it("puts the name in the title line", () => {
    expect(applyName(TEMPLATE, "Ada").startsWith("# Ada\n")).toBe(true);
    expect(applyName(TEMPLATE, " ").startsWith("# Smith\n")).toBe(true);
    expect(applyName("No title", "Ada")).toBe("# Ada\n\nNo title");
  });
});
