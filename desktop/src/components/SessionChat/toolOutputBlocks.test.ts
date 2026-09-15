import { describe, expect, it } from "vitest";

import { diffLineKind, looksLikeDiff, parseToolOutput } from "./toolOutputBlocks";

describe("parseToolOutput", () => {
  it("leaves plain text as one block", () => {
    expect(parseToolOutput("1 test passed")).toEqual([{ kind: "text", text: "1 test passed" }]);
  });

  it("returns nothing for blank output", () => {
    expect(parseToolOutput("")).toEqual([]);
    expect(parseToolOutput("\n  \n")).toEqual([]);
  });

  it("strips the fences and keeps a known language tag", () => {
    expect(parseToolOutput("before\n```console\n$ ls\na.ts\n```\nafter")).toEqual([
      { kind: "text", text: "before" },
      { kind: "code", label: "console", lang: "console", text: "$ ls\na.ts" },
      { kind: "text", text: "after" },
    ]);
  });

  it("renders an untagged fence as code with no label", () => {
    expect(parseToolOutput("```\nbare\n```")).toEqual([
      { kind: "code", label: null, lang: null, text: "bare" },
    ]);
  });

  it("renders an unknown tag as code with no label", () => {
    expect(parseToolOutput("```gibberish\nx\n```")).toEqual([
      { kind: "code", label: null, lang: "gibberish", text: "x" },
    ]);
  });

  it("normalises an alias tag to its language name", () => {
    expect(parseToolOutput("```ts\nconst a = 1;\n```")).toEqual([
      { kind: "code", label: "typescript", lang: "ts", text: "const a = 1;" },
    ]);
  });

  it("keeps the rest of the output when a fence is never closed", () => {
    expect(parseToolOutput("head\n```sh\nnpm test")).toEqual([
      { kind: "text", text: "head" },
      { kind: "code", label: "shell", lang: "sh", text: "npm test" },
    ]);
  });

  it("does not close a fence on a line that carries an info string", () => {
    expect(parseToolOutput("```sh\n```ts\ndone\n```")).toEqual([
      { kind: "code", label: "shell", lang: "sh", text: "```ts\ndone" },
    ]);
  });

  it("turns a diff-tagged fence into a diff block", () => {
    expect(parseToolOutput("```diff\n-old\n+new\n```")).toEqual([
      { kind: "diff", text: "-old\n+new" },
    ]);
  });

  it("treats a patch-tagged fence as a diff", () => {
    expect(parseToolOutput("```patch\n+x\n```")).toEqual([{ kind: "diff", text: "+x" }]);
  });

  it("detects an unfenced diff", () => {
    const patch = "diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new";
    expect(parseToolOutput(patch)).toEqual([{ kind: "diff", text: patch }]);
  });

  it("handles tilde fences", () => {
    expect(parseToolOutput("~~~json\n{}\n~~~")).toEqual([
      { kind: "code", label: "json", lang: "json", text: "{}" },
    ]);
  });
});

describe("looksLikeDiff", () => {
  it("accepts a git header", () => {
    expect(looksLikeDiff("diff --git a/x b/x\nwhatever")).toBe(true);
  });

  it("accepts a hunk header", () => {
    expect(looksLikeDiff("@@ -1,2 +1,3 @@\n context")).toBe(true);
  });

  it("accepts a run of mixed change lines", () => {
    expect(looksLikeDiff("-a\n-b\n+c")).toBe(true);
  });

  it("rejects a markdown bullet list", () => {
    expect(looksLikeDiff("- one\n- two\n- three")).toBe(false);
  });

  it("rejects a short change run", () => {
    expect(looksLikeDiff("-a\n+b")).toBe(false);
  });

  it("rejects prose", () => {
    expect(looksLikeDiff("Found 3 matches in src/app.ts")).toBe(false);
  });
});

describe("diffLineKind", () => {
  it("classifies each line shape", () => {
    expect(diffLineKind("+added")).toBe("add");
    expect(diffLineKind("-removed")).toBe("del");
    expect(diffLineKind("@@ -1 +1 @@")).toBe("meta");
    expect(diffLineKind("--- a/x.ts")).toBe("meta");
    expect(diffLineKind("+++ b/x.ts")).toBe("meta");
    expect(diffLineKind("diff --git a/x b/x")).toBe("meta");
    expect(diffLineKind("index e69de29..4b825dc")).toBe("meta");
    expect(diffLineKind(" untouched")).toBe("context");
  });
});

describe("markdown tables in tool output", () => {
  const table = [
    "| id | agent | status |",
    "| :--- | :---: | ---: |",
    "| t_1 | opencode | waiting |",
    "| t_2 | claude | running |",
  ].join("\n");

  it("reads a table as a table, not as text", () => {
    const blocks = parseToolOutput(table);
    expect(blocks).toHaveLength(1);
    const block = blocks[0];
    if (block.kind !== "table") throw new Error("expected a table");
    expect(block.header).toEqual(["id", "agent", "status"]);
    expect(block.rows).toEqual([
      ["t_1", "opencode", "waiting"],
      ["t_2", "claude", "running"],
    ]);
    expect(block.align).toEqual(["left", "center", "right"]);

    // A bare `---` claims nothing; only colons ask for an alignment.
    const plain = parseToolOutput("| a | b |\n| --- | --- |\n| 1 | 2 |")[0];
    if (plain.kind !== "table") throw new Error("expected a table");
    expect(plain.align).toEqual([null, null]);
    expect(block.text).toBe(table);
  });

  it("keeps the lines around a table as their own text blocks", () => {
    const blocks = parseToolOutput(`some preamble\n${table}\ntrailing note`);
    expect(blocks.map((block) => block.kind)).toEqual(["text", "table", "text"]);
  });

  it("pads a short row and truncates a long one to the header's width", () => {
    const blocks = parseToolOutput("| a | b |\n| --- | --- |\n| 1 |\n| 1 | 2 | 3 |");
    const block = blocks[0];
    if (block.kind !== "table") throw new Error("expected a table");
    expect(block.rows).toEqual([
      ["1", ""],
      ["1", "2"],
    ]);
  });

  it("treats an escaped pipe as cell text", () => {
    const blocks = parseToolOutput("| flag | note |\n| --- | --- |\n| a\\|b | x |");
    const block = blocks[0];
    if (block.kind !== "table") throw new Error("expected a table");
    expect(block.rows).toEqual([["a|b", "x"]]);
  });

  it("leaves pipes that are not a table alone", () => {
    for (const content of [
      "ps aux | grep node | head",
      "| not | a table |",
      "| a | b |\n| 1 | 2 |",
      "| a | b |\n| --- | --- |",
    ]) {
      expect(parseToolOutput(content).every((block) => block.kind !== "table")).toBe(true);
    }
  });
});
