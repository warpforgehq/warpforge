import { describe, expect, it } from "vitest";

import { parseFileLocation } from "./fileLocation";

describe("parseFileLocation", () => {
  it.each([
    ["src/main.ts", { path: "src/main.ts" }],
    ["src/main.ts:53", { line: 53, path: "src/main.ts" }],
    ["src/main.ts:53:12", { column: 12, line: 53, path: "src/main.ts" }],
    ["src/main.ts:53-60", { endLine: 60, line: 53, path: "src/main.ts" }],
    ["src/main.ts:53–60", { endLine: 60, line: 53, path: "src/main.ts" }],
    ["src/main.ts#L53", { line: 53, path: "src/main.ts" }],
    ["src/main.ts#L53-L60", { endLine: 60, line: 53, path: "src/main.ts" }],
    ["src/main.ts#L53-60", { endLine: 60, line: 53, path: "src/main.ts" }],
    ["/Users/dev/app/src/main.ts:53", { line: 53, path: "/Users/dev/app/src/main.ts" }],
  ])("parses %s", (text, expected) => {
    expect(parseFileLocation(text)).toEqual(expected);
  });

  it("trims surrounding whitespace", () => {
    expect(parseFileLocation("  src/main.ts:53  ")).toEqual({ line: 53, path: "src/main.ts" });
  });

  it.each([
    "https://github.com/warpforgehq/warpforge/pull/4",
    "http://localhost:3000",
    "C:\\Users\\dev\\app.ts",
    "src/main.ts",
  ])("leaves %s intact", (text) => {
    expect(parseFileLocation(text)).toEqual({ path: text });
  });

  it("does not treat a drive letter alone as a line", () => {
    expect(parseFileLocation("C:\\file.ts")).toEqual({ path: "C:\\file.ts" });
  });

  it("keeps a Windows path and strips its real line suffix", () => {
    expect(parseFileLocation("C:\\src\\app.ts:53-60")).toEqual({
      endLine: 60,
      line: 53,
      path: "C:\\src\\app.ts",
    });
  });

  it("ignores a backwards or zero range", () => {
    expect(parseFileLocation("src/main.ts:60-53")).toEqual({ path: "src/main.ts:60-53" });
    expect(parseFileLocation("src/main.ts:0")).toEqual({ path: "src/main.ts:0" });
    expect(parseFileLocation(":53")).toEqual({ path: ":53" });
  });

  it("leaves empty text empty", () => {
    expect(parseFileLocation("")).toEqual({ path: "" });
  });
});
