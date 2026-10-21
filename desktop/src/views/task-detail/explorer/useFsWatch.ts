import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { daemon } from "@/daemon";

import type { WatchedRoot } from "../../../protocol";
import { applyFsChange } from "./fsChange";
import type { ExplorerSubject } from "./useExplorerData";

/**
 * Watches the subject's checkout while mounted, re-watching after a reconnect,
 * and applies its `fs.changed` events to the query cache.
 * @param subject the task or project whose checkout the tree shows
 * @returns whether changes may go unreported, so the tree should poll on focus
 */
export function useFsWatch(subject: ExplorerSubject): { degraded: boolean } {
  const queryClient = useQueryClient();
  const { taskId, project } = subject;
  const [watched, setWatched] = useState<WatchedRoot | null>(null);

  useEffect(() => {
    if (!taskId && !project) return;
    const params = taskId ? { task_id: taskId } : { project };
    let root: string | null = null;
    let live = true;
    const watch = () => {
      if (daemon.getState().connection !== "connected") return;
      daemon
        .request("fs.watch", params)
        .then((result) => {
          const reply = result as WatchedRoot;
          if (!live) {
            daemon.request("fs.unwatch", params).catch(() => {});
            return;
          }
          root = reply.root;
          setWatched(reply);
        })
        .catch(() => {
          if (live) setWatched(null);
        });
    };
    let connected = daemon.getState().connection === "connected";
    const offState = daemon.subscribe(() => {
      const now = daemon.getState().connection === "connected";
      if (now && !connected) watch();
      if (!now) setWatched(null);
      connected = now;
    });
    const offEvents = daemon.subscribeEvents((event) => {
      if (event.event !== "fs.changed" || event.data.root !== root) return;
      applyFsChange(queryClient, { project, taskId }, event.data);
      if (event.data.degraded) setWatched((current) => current && { ...current, degraded: true });
    });
    watch();
    return () => {
      live = false;
      offState();
      offEvents();
      setWatched(null);
      if (root !== null && daemon.getState().connection === "connected") {
        daemon.request("fs.unwatch", params).catch(() => {});
      }
    };
  }, [project, queryClient, taskId]);

  return { degraded: watched?.degraded ?? true };
}
