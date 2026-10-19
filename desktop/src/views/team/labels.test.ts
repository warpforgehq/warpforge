import { describe, expect, it } from "vitest";

import { shortLabel } from "./labels";

describe("shortLabel", () => {
  it("keeps a short label and cuts a long one", () => {
    expect(shortLabel("Oly")).toBe("Oly");
    const long = "Oly · Test task: git pull, then report TEST-REPORT-OK";
    expect(shortLabel(long)).toBe(`${Array.from(long).slice(0, 27).join("")}…`);
    expect(Array.from(shortLabel(long))).toHaveLength(28);
  });
});
