import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import {
  DB_NAME,
  DB_VERSION,
  MAX_PROJECT_SESSIONS,
  MAX_TASK_SESSIONS,
  PROJECT_STORE,
  TASK_STORE,
  TTL_MS,
  type ProjectWorkspaceSession,
  type TaskWorkspaceSession,
} from "./types";

export interface SessionDB extends DBSchema {
  [TASK_STORE]: {
    key: string;
    value: TaskWorkspaceSession;
    indexes: { byUpdatedAt: number };
  };
  [PROJECT_STORE]: {
    key: string;
    value: ProjectWorkspaceSession;
    indexes: { byUpdatedAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<SessionDB> | null> | null = null;

/**
 * Open the session DB, or resolve `null` when IndexedDB is unavailable (private
 * mode, no `indexedDB` global). Every caller treats `null` as a no-op cache.
 */
export function getDB(): Promise<IDBPDatabase<SessionDB> | null> {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === "undefined") {
    dbPromise = Promise.resolve(null);
    return dbPromise;
  }
  dbPromise = openDB<SessionDB>(DB_NAME, DB_VERSION, {
    blocking() {
      void dbPromise?.then((db) => db?.close());
    },
    blocked() {
      // Another window is holding an older connection; keep working in memory.
    },
    terminated() {
      dbPromise = null;
    },
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const tasks = db.createObjectStore(TASK_STORE, { keyPath: "taskId" });
        tasks.createIndex("byUpdatedAt", "updatedAt");
        const projects = db.createObjectStore(PROJECT_STORE, { keyPath: "project" });
        projects.createIndex("byUpdatedAt", "updatedAt");
      }
    },
  }).catch(() => {
    dbPromise = null;
    return null;
  });
  return dbPromise;
}

/** Delete records past the TTL and, if still over cap, the least-recently-updated. */
export async function sweep(db: IDBPDatabase<SessionDB>): Promise<void> {
  const cutoff = Date.now() - TTL_MS;
  for (const [store, max] of [
    [TASK_STORE, MAX_TASK_SESSIONS],
    [PROJECT_STORE, MAX_PROJECT_SESSIONS],
  ] as const) {
    const tx = db.transaction(store, "readwrite");
    const index = tx.store.index("byUpdatedAt");
    for await (const cursor of index.iterate(IDBKeyRange.upperBound(cutoff))) {
      await cursor.delete();
    }
    const total = await tx.store.count();
    let excess = total - max;
    if (excess > 0) {
      for await (const cursor of index.iterate()) {
        if (excess <= 0) break;
        await cursor.delete();
        excess -= 1;
      }
    }
    await tx.done;
  }
}

/** Test hook: drop the cached connection so a fresh `getDB()` reopens. */
export async function resetDBForTests(): Promise<void> {
  const current = dbPromise;
  dbPromise = null;
  const db = await current;
  db?.close();
}
