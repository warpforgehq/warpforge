import { useEffect, useMemo, useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import { peerAlertReasons, unreadCount } from "@/lib/peerFeed";
import { taskLabel } from "@/lib/taskLabel";
import type { DaemonEvent, TaskInfo } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useUi } from "@/store/ui";

/** How many of the newest records the app loads on connect. */
export const FEED_PAGE = 500;

const getConnection = () => daemon.getState().connection;

/** Load the feed and controls on every connect, then follow
 *  `peer.messageUpdated`. Mounted once, by `PeerFeedHost`. */
export function usePeerFeedSync() {
  const connection = useSyncExternalStore(daemon.subscribe, getConnection);
  useEffect(() => {
    if (connection !== "connected") return;
    let cancelled = false;
    void Promise.all([daemon.peerFeed({ limit: FEED_PAGE }), daemon.peerControls()])
      .then(([records, controls]) => {
        if (!cancelled) usePeersStore.getState().load(records, controls);
      })
      .catch(() => {});
    const unsubscribe = daemon.subscribeEvents((event: DaemonEvent) => {
      if (event.event === "peer.messageUpdated") usePeersStore.getState().upsert(event.data);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [connection]);
}

/**
 * Live message-limit alerts as needs-you reasons, by task id.
 * @param tasks the snapshot's tasks, to name the sessions
 * @returns reasons by task id
 */
export function usePeerAlertReasons(tasks: TaskInfo[]): ReadonlyMap<string, string> {
  const records = usePeersStore((state) => state.records);
  return useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const label = (id: string) => {
      const task = byId.get(id);
      return task ? taskLabel(task) : id;
    };
    return peerAlertReasons(Object.values(records), label);
  }, [records, tasks]);
}

/** @returns feed records the user has not seen in the Team view */
export function useTeamUnread(): number {
  const records = usePeersStore((state) => state.records);
  const seenAt = useUi((state) => state.teamSeenAt);
  return useMemo(() => unreadCount(Object.values(records), seenAt), [records, seenAt]);
}
