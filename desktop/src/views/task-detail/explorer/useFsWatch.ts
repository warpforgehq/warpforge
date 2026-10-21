import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { daemon } from "@/daemon";

import type { WatchedRoot } from "../../../protocol";
import { applyFsChange } from "./fsChange";
import type { ExplorerSubject } from "./useExplorerData";

/** One `fs.watch` for a subject, shared by every mounted hook that asks for it. */
interface SharedWatch {
  refs: number;
  degraded: boolean;
  listeners: Set<(degraded: boolean) => void>;
  stop: () => void;
}

const watches = new WeakMap<QueryClient, Map<string, SharedWatch>>();

function start(
  queryClient: QueryClient,
  subject: ExplorerSubject,
  shared: SharedWatch,
): () => void {
  const params = subject.taskId ? { task_id: subject.taskId } : { project: subject.project };
  let root: string | null = null;
  let live = true;
  const setDegraded = (degraded: boolean) => {
    shared.degraded = degraded;
    for (const listener of shared.listeners) listener(degraded);
  };
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
        setDegraded(reply.degraded);
      })
      .catch(() => {
        if (live) setDegraded(true);
      });
  };
  let connected = daemon.getState().connection === "connected";
  const offState = daemon.subscribe(() => {
    const now = daemon.getState().connection === "connected";
    if (now && !connected) watch();
    if (!now) setDegraded(true);
    connected = now;
  });
  const offEvents = daemon.subscribeEvents((event) => {
    if (event.event !== "fs.changed" || event.data.root !== root) return;
    applyFsChange(queryClient, subject, event.data);
    if (event.data.degraded) setDegraded(true);
  });
  watch();
  return () => {
    live = false;
    offState();
    offEvents();
    if (root !== null && daemon.getState().connection === "connected") {
      daemon.request("fs.unwatch", params).catch(() => {});
    }
  };
}

/**
 * Watches the subject's checkout while any caller is mounted, re-watching after
 * a reconnect, and applies its `fs.changed` events to the query cache once
 * however many callers share it.
 * @param subject the task or project whose checkout is watched
 * @returns whether changes may go unreported, so callers should poll on focus
 */
export function useFsWatch(subject: ExplorerSubject): { degraded: boolean } {
  const queryClient = useQueryClient();
  const { taskId, project } = subject;
  const [degraded, setDegraded] = useState(true);

  useEffect(() => {
    if (!taskId && !project) return;
    const key = taskId ? `task:${taskId}` : `project:${project}`;
    const byKey = watches.get(queryClient) ?? new Map<string, SharedWatch>();
    watches.set(queryClient, byKey);
    let shared = byKey.get(key);
    if (!shared) {
      const created: SharedWatch = {
        degraded: true,
        listeners: new Set(),
        refs: 0,
        stop: () => {},
      };
      created.stop = start(queryClient, { project, taskId }, created);
      byKey.set(key, created);
      shared = created;
    }
    const current = shared;
    current.refs += 1;
    current.listeners.add(setDegraded);
    setDegraded(current.degraded);
    return () => {
      current.listeners.delete(setDegraded);
      current.refs -= 1;
      if (current.refs === 0) {
        current.stop();
        byKey.delete(key);
      }
    };
  }, [project, queryClient, taskId]);

  return { degraded };
}
