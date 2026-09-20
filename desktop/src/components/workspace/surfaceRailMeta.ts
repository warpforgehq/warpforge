import type { SurfaceTab, WorkspaceSurface } from "./SurfaceTabs";

const NOUNS: Record<WorkspaceSurface, readonly [string, string]> = {
  browser: ["tab", "tabs"],
  diff: ["changed file", "changed files"],
  files: ["file", "files"],
  pipeline: ["stage", "stages"],
  runtime: ["service or port-forward", "services and port-forwards"],
  terminal: ["session", "sessions"],
};

const RESTING: Record<WorkspaceSurface, string> = {
  browser: "Browse the web",
  diff: "No changes yet",
  files: "Project tree and editor",
  pipeline: "No stages",
  runtime: "Nothing running",
  terminal: "No sessions",
};

/**
 * What a surface holds right now, said the same way in the rail's tooltip, its
 * screen-reader label and the pane header — so the badge number and the
 * sentence beside it can never disagree.
 *
 * @param tab The surface, carrying the same live count the tab bar shows.
 * @returns A short phrase such as `3 changed files`, or the resting line.
 */
export function surfaceSummary(tab: SurfaceTab): string {
  const count = typeof tab.count === "number" ? tab.count : 0;
  if (count <= 0) return RESTING[tab.id];
  const [one, many] = NOUNS[tab.id];
  return `${count} ${count === 1 ? one : many}`;
}
