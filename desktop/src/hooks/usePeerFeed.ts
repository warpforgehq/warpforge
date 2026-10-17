import { useEffect, useMemo, useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import { peerAlertReasons, unreadCount } from "@/lib/peerFeed";
import { taskLabel } from "@/lib/taskLabel";
import type { Channel, DaemonEvent, PeerMessage, TaskInfo } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useUi } from "@/store/ui";

/** How many of the newest records the app loads on connect: the daemon's
 *  page limit. Live alerts are fetched on their own, whatever their age. */
export const FEED_PAGE = 200;

const getConnection = () => daemon.getState().connection;

/** Load the feed, live alerts and controls on every connect, then follow
 *  `peer.messageUpdated`. Mounted once, by `PeerFeedHost`. */
export function usePeerFeedSync() {
  const connection = useSyncExternalStore(daemon.subscribe, getConnection);
  useEffect(() => {
    if (connection !== "connected") return;
    let cancelled = false;
    // An update that arrives while the page is in flight is newer than the
    // page; it is applied after it, not overwritten by it.
    let pending: Map<number, PeerMessage> | null = new Map();
    const unsubscribe = daemon.subscribeEvents((event: DaemonEvent) => {
      if (event.event !== "peer.messageUpdated") return;
      pending?.set(event.data.id, event.data);
      usePeersStore.getState().upsert(event.data);
    });
    void Promise.all([
      daemon.peerFeed({ limit: FEED_PAGE }),
      daemon.peerAlerts(),
      daemon.peerControls(),
    ])
      .then(([page, alerts, controls]) => {
        if (cancelled) return;
        const newer = [...(pending?.values() ?? [])];
        usePeersStore.getState().load([...alerts, ...page, ...newer], controls);
        seedTeamSeen(page);
      })
      .catch(() => {
        if (!cancelled) usePeersStore.setState({ loaded: true });
      })
      .finally(() => {
        pending = null;
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [connection]);
}

/** Load the named channels on every connect, then follow `channel.updated`
 *  and `channel.removed`. Separate from the feed so a daemon without channels
 *  still loads its feed. */
export function useChannelsSync() {
  const connection = useSyncExternalStore(daemon.subscribe, getConnection);
  useEffect(() => {
    if (connection !== "connected") return;
    let cancelled = false;
    let pending: Map<string, Channel | null> | null = new Map();
    const unsubscribe = daemon.subscribeEvents((event: DaemonEvent) => {
      if (event.event === "channel.updated") {
        pending?.set(event.data.id, event.data);
        usePeersStore.getState().upsertChannel(event.data);
      } else if (event.event === "channel.removed") {
        pending?.set(event.data.id, null);
        usePeersStore.getState().removeChannel(event.data.id);
      }
    });
    daemon
      .listChannels()
      .then((channels) => {
        if (cancelled) return;
        const merged = new Map(channels.map((c) => [c.id, c as Channel | null]));
        for (const [id, channel] of pending ?? []) merged.set(id, channel);
        usePeersStore
          .getState()
          .setChannels([...merged.values()].filter((c): c is Channel => c !== null));
      })
      .catch(() => {})
      .finally(() => {
        pending = null;
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [connection]);
}

/** A first load would otherwise count the whole page as unread. */
function seedTeamSeen(page: PeerMessage[]) {
  const ui = useUi.getState();
  if (ui.teamSeenAt !== 0) return;
  const newest = page.reduce((max, record) => Math.max(max, record.createdAt), 0);
  ui.markTeamSeen(newest || Math.floor(Date.now() / 1000));
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
