import type { Scene } from "../types";
import { diffFor, FACTORY_TASK_ID, fileDocFor, runnerAt, snapshot } from "./fixtures";
import { script } from "./script";

/** A backlog item started in Factory, walked from the queue to a draft PR. */
export const factory: Scene = {
  id: "factory",
  openTaskId: FACTORY_TASK_ID,
  // The status the queued item starts from; later states arrive as
  // `runner.updated`, which the app folds into this same query.
  request: (method) =>
    method === "runner.status" ? Promise.resolve(runnerAt({ state: "queued" })) : undefined,
  script: () => script,
  seed: () => ({ diffFor, fileDocFor, sessionUpdates: {}, snapshot }),
};
