import { expect, it } from "vitest";

import {
  DEFAULT_PROJECT_SECTION_PREFS,
  orderedSections,
  resolveSection,
  visibleSections,
  withSectionHidden,
  withSectionMoved,
} from "./projectSections";

it("lists every section in the built-in order by default", () => {
  expect(visibleSections(DEFAULT_PROJECT_SECTION_PREFS)).toEqual([
    "backlog",
    "pulls",
    "files",
    "runtime",
    "terminal",
    "worktrees",
    "config",
  ]);
});

it("keeps the last visible section from being hidden", () => {
  let prefs = DEFAULT_PROJECT_SECTION_PREFS;
  for (const id of [
    "backlog",
    "pulls",
    "files",
    "runtime",
    "terminal",
    "worktrees",
    "config",
  ] as const) {
    prefs = withSectionHidden(prefs, id, true);
  }
  expect(visibleSections(prefs)).toEqual(["config"]);
});

it("falls back to the first visible section when the remembered one is hidden", () => {
  const prefs = withSectionHidden(DEFAULT_PROJECT_SECTION_PREFS, "backlog", true);
  expect(resolveSection("backlog", prefs)).toBe("pulls");
  expect(resolveSection("runtime", prefs)).toBe("runtime");
  expect(resolveSection(undefined, prefs)).toBe("pulls");
});

it("moves a section and appends sections missing from a stored order", () => {
  const prefs = withSectionMoved(DEFAULT_PROJECT_SECTION_PREFS, "runtime", -1);
  expect(orderedSections(prefs).slice(0, 4)).toEqual(["backlog", "pulls", "runtime", "files"]);
  expect(orderedSections({ hidden: [], order: ["terminal"] })[0]).toBe("terminal");
  expect(orderedSections({ hidden: [], order: ["terminal"] })).toHaveLength(7);
  expect(withSectionMoved(prefs, "backlog", -1)).toBe(prefs);
});
