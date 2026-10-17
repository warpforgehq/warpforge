import { useEffect, useMemo, useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import type { DaemonEvent, Smith } from "@/protocol";
import { useSmithsStore } from "@/store/smiths";

const getConnection = () => daemon.getState().connection;

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
