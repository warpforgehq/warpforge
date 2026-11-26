import { describe, expect, it } from "vitest";

import { approvePermissionOption, quickApproveOption } from "./permissionApproval";

describe("approvePermissionOption", () => {
  it.each([
    // The daemon's canonical labels: one-shot allow wins, never allow_always.
    [["allow", "allow_always", "deny"], "allow"],
    [["allow_always", "deny"], undefined],
    [["deny"], undefined],
    // Legacy/foreign spellings normalize to the same rule.
    [["Allow once", "deny"], "Allow once"],
    [["always_allow", "deny"], undefined],
    [["approve_once", "deny"], "approve_once"],
  ])("resolves %j to %j", (options, expected) => {
    expect(approvePermissionOption(options)).toBe(expected);
  });
});

it("requires a browser origin grant to be reviewed in the task", () => {
  const options = ["allow", "allow_always", "deny"];
  expect(quickApproveOption({ options })).toBe("allow");
  expect(quickApproveOption({ options, browser_origin: "https://example.com" })).toBeUndefined();
});
