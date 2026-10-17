import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import { endedTurns, smithUnread } from "@/lib/smiths";
import type { DaemonEvent, SessionUpdate, Smith, TaskInfo } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useSmithsStore } from "@/store/smiths";
import { useUi } from "@/store/ui";

const getConnection = () => daemon.getState().connection;
const NO_UPDATES: SessionUpdate[] = [];

/** Load the Smiths on every connect, then follow `smith.updated` and
 *  `smith.removed`. Mounted once, by `SmithsHost`. */
export function useSmithsSync() {
  const connection = useSyncExternalStore(daemon.subscribe, getConnection);
  useEffect(() => {
    if (connection !== "connected") return;
    let cancelled = false;
    // Events that arrive while the list is in flight are newer than it.
    let pending: Map<string, Smith | null> | null = new Map();
    const unsubscribe = daemon.subscribeEvents((event: DaemonEvent) => {
      if (event.event === "smith.updated") {
        pending?.set(event.data.id, event.data);
        useSmithsStore.getState().upsert(event.data);
      } else if (event.event === "smith.removed") {
        pending?.set(event.data.id, null);
        useSmithsStore.getState().remove(event.data.id);
      }
    });
    daemon
      .listSmiths()
      .then((smiths) => {
        if (cancelled) return;
        const merged = new Map(smiths.map((smith) => [smith.id, smith as Smith | null]));
        for (const [id, smith] of pending ?? []) merged.set(id, smith);
        useSmithsStore
          .getState()
          .load([...merged.values()].filter((smith): smith is Smith => smith !== null));
      })
      .catch(() => {
        if (!cancelled) useSmithsStore.setState({ loaded: true });
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

/** @returns every Smith, by name */
export function useSmiths(): Smith[] {
  const smiths = useSmithsStore((state) => state.smiths);
  return useMemo(
    () => Object.values(smiths).sort((a, b) => a.name.localeCompare(b.name)),
    [smiths],
  );
}

/** @returns how many turns of a thread task have ended, live */
function useEndedTurns(taskId: string): number {
  const read = useCallback(
    () => endedTurns(daemon.getState().sessionUpdates[taskId] ?? NO_UPDATES),
    [taskId],
  );
  return useSyncExternalStore(daemon.subscribe, read, read);
}

/**
 * New things from one teammate since its page was last open: replies in its
 * conversation and its sessions' feed records.
 * @param smith the Smith
 * @param tasks the snapshot's tasks
 * @returns the unread count
 */
export function useSmithUnread(smith: Smith, tasks: TaskInfo[]): number {
  const turns = useEndedTurns(smith.threadTaskId);
  const seenTurns = useSmithsStore((state) => state.seenTurns[smith.id]);
  const records = usePeersStore((state) => state.records);
  const seenAt = useUi((state) => state.teamSmithSeenAt[smith.id] ?? state.teamSeenAt);
  useEffect(() => {
    // Replies already in memory when the app first sees the teammate are not new.
    if (seenTurns === undefined) useSmithsStore.getState().markTurnsSeen(smith.id, turns);
  }, [seenTurns, smith.id, turns]);
  return useMemo(
    () =>
      smithUnread(
        smith,
        Object.values(records),
        tasks,
        seenAt,
        seenTurns === undefined ? 0 : turns - seenTurns,
      ),
    [records, seenAt, seenTurns, smith, tasks, turns],
  );
}

/** While a teammate's page is open, everything it says counts as read. */
export function useMarkSmithSeen(smith: Smith) {
  const turns = useEndedTurns(smith.threadTaskId);
  const records = usePeersStore((state) => state.records);
  const markSmithSeen = useUi((state) => state.markSmithSeen);
  useEffect(() => {
    markSmithSeen(smith.id, Math.floor(Date.now() / 1000));
    useSmithsStore.getState().markTurnsSeen(smith.id, turns);
  }, [markSmithSeen, records, smith.id, turns]);
}
