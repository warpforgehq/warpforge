import type { Smith } from "@/protocol";
import { useSmithsStore } from "@/store/smiths";

/**
 * @param overrides fields to replace
 * @returns a Smith allowed in `warpforge`
 */
export function smithFixture(overrides: Partial<Smith> = {}): Smith {
  return {
    agent: "claude",
    allowedProjects: ["warpforge"],
    budget: {},
    charterRev: "c1",
    createdAt: 1,
    homeProject: "warpforge",
    id: "sm_1",
    name: "Ada",
    permissions: { createPr: false, push: false, writePaths: [] },
    soulRev: "s1",
    threadTaskId: "t_thread",
    ...overrides,
  };
}

/**
 * Replace the Smith store's contents.
 * @param smiths the Smiths to hold
 */
export function setSmiths(smiths: Smith[]) {
  useSmithsStore.setState({
    loaded: true,
    smiths: Object.fromEntries(smiths.map((smith) => [smith.id, smith])),
  });
}
