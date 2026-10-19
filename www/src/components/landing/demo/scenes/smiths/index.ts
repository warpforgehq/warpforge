import { daemon } from "@app/daemon";

import { diff, fileDocFor } from "../factory/fixtures";
import type { Scene } from "../types";
import { CHANNEL_KEY, channel, detailOf, SMITHS, snapshot, WORK_TASK_ID } from "./fixtures";
import { smithsScript } from "./script";

let now = Math.floor(Date.now() / 1000);

/** The work session's diff: the files its transcript has reported editing. */
function diffFor() {
  const edited = new Set(
    (daemon.getState().sessionUpdates[WORK_TASK_ID] ?? []).flatMap((update) =>
      update.kind === "file_edit" ? [update.path] : [],
    ),
  );
  return { ...diff, files: diff.files.filter((file) => edited.has(file.path)), taskId: WORK_TASK_ID };
}

/** A request in a channel, agreed between Smiths, then worked on as one of them. */
export const smiths: Scene = {
  hold: 10_000,
  id: "smiths",
  nav: {
    openTaskId: null,
    sidebarMode: "team",
    smithsProject: channel.project,
    teamSelection: { key: CHANNEL_KEY, kind: "conversation" },
    view: "team",
  },
  openTaskId: null,
  request: (method, params) => {
    if (method === "smiths.get") {
      return Promise.resolve(detailOf(String((params as { id?: unknown })?.id)));
    }
    if (method === "backlog.list") {
      return Promise.resolve({ hasNextPage: false, items: [], page: 1, pageSize: 50, total: 0 });
    }
    return undefined;
  },
  script: () => smithsScript(now),
  seed: () => {
    now = Math.floor(Date.now() / 1000);
    return { channels: [channel], diffFor, fileDocFor, sessionUpdates: {}, smiths: SMITHS, snapshot };
  },
};
