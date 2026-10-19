import { unchangedDoc } from "../orchestrate/files";
import type { Scene } from "../types";
import { PR_TASK_ID, sessionUpdates, snapshot, timeline, worktreeDiff } from "./fixtures";
import { servePulls } from "./rpc";
import { pullsScript } from "./script";

let world = timeline(Math.floor(Date.now() / 1000));

/** A task's PR gets a failing check and a review comment; then the PR itself. */
export const pulls: Scene = {
  // Long enough to read the review before the replay takes it away.
  hold: 15_000,
  id: "pulls",
  openTaskId: PR_TASK_ID,
  request: (method, params) => servePulls(world, method, params),
  script: () => pullsScript(world),
  seed: () => {
    world = timeline(Math.floor(Date.now() / 1000));
    return { diffFor: () => worktreeDiff, fileDocFor: unchangedDoc, sessionUpdates, snapshot };
  },
};
