import type { Scene } from "../types";
import { projectFiles } from "./files";
import { diffFor, fileDocFor, LEAD_TASK_ID, snapshot } from "./fixtures";
import { script } from "./script";

/** Pre-opened in the editor so the Files surface is never an empty pane. */
const OPEN_FILE = "api/src/middleware/rate-limit.ts";

/** One orchestrator task that delegates to two sub-agents and lands one diff. */
export const orchestrate: Scene = {
  id: "orchestrate",
  openTaskId: LEAD_TASK_ID,
  /**
   * Widen `file.list` for the demo.
   *
   * Demo mode answers it with the diff's own files, which leaves the file tree
   * showing a four-file repository. The changed flags come from the live diff,
   * so the tree and the changes rail can never disagree.
   */
  request: (method) =>
    method === "file.list"
      ? Promise.resolve(projectFiles(diffFor().files.map((file) => file.path)))
      : undefined,
  script: () => script,
  seed: () => ({ diffFor, fileDocFor, sessionUpdates: {}, snapshot }),
  // Open a file through the app's own "go to this file" navigation, so the
  // Files tab has a loaded editor waiting. AppDemo puts the surface it forces
  // back to the diff once the navigation has been consumed.
  ui: { openTaskNav: { path: OPEN_FILE, surface: "files" } },
};
