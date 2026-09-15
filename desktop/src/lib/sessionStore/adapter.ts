import { getDB, sweep } from "./db";
import {
  PROJECT_STORE,
  SWEEP_MIN_INTERVAL_MS,
  TASK_STORE,
  WRITE_DEBOUNCE_MS,
  capTabList,
  capViews,
  type ProjectWorkspaceSession,
  type TaskWorkspaceSession,
} from "./types";

export type StoreName = typeof TASK_STORE | typeof PROJECT_STORE;
export type SessionRecord = TaskWorkspaceSession | ProjectWorkspaceSession;

const pending = new Map<string, ReturnType<typeof setTimeout>>();
const queue = new Map<string, SessionRecord>();

let broadcast: BroadcastChannel | null = null;
function channel(): BroadcastChannel | null {
  if (broadcast) return broadcast;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    broadcast = new BroadcastChannel("warpforge-session");
  } catch {
    broadcast = null;
  }
  return broadcast;
}

let lastSweep = 0;
/** Sweep off the write path, at most once a minute. */
function scheduleSweep(): void {
  const now = Date.now();
  if (now - lastSweep < SWEEP_MIN_INTERVAL_MS) return;
  lastSweep = now;
  void getDB().then((db) => {
    if (db) void sweep(db).catch(() => {});
  });
}

function recordKey(store: StoreName, key: string): string {
  return `${store}\0${key}`;
}

async function writeNow(store: StoreName, key: string, value: SessionRecord): Promise<void> {
  const db = await getDB();
  if (!db) return;
  try {
    await db.put(store, value);
    channel()?.postMessage({ key, store, type: "session-updated" });
    scheduleSweep();
  } catch {
    // Quota or storage failure: evict and retry once, then drop. Cache only.
    try {
      await sweep(db);
      await db.put(store, value);
    } catch {
      // no-op
    }
  }
}

async function flushWrite(store: StoreName, key: string): Promise<void> {
  const id = recordKey(store, key);
  const timer = pending.get(id);
  if (timer !== undefined) clearTimeout(timer);
  pending.delete(id);
  const value = queue.get(id);
  queue.delete(id);
  if (value === undefined) return;
  await writeNow(store, key, value);
}

function scheduleWrite(store: StoreName, key: string, value: SessionRecord): void {
  const id = recordKey(store, key);
  queue.set(id, value);
  if (pending.has(id)) return;
  pending.set(
    id,
    setTimeout(() => void flushWrite(store, key), WRITE_DEBOUNCE_MS),
  );
}

/** All pending writes, awaited. Safe to call with nothing queued. */
export async function flush(): Promise<void> {
  const ids = [...pending.keys()];
  await Promise.all(
    ids.map((id) => {
      const [store, key] = id.split("\0") as [StoreName, string];
      return flushWrite(store, key);
    }),
  );
}

export function putTask(session: TaskWorkspaceSession): void {
  const capped: TaskWorkspaceSession = {
    ...session,
    files: {
      ...session.files,
      tabs: capTabList(session.files.tabs),
      views: capViews(session.files.views, session.files.tabs),
    },
  };
  scheduleWrite(TASK_STORE, session.taskId, capped);
}

export function putProject(session: ProjectWorkspaceSession): void {
  const capped: ProjectWorkspaceSession = {
    ...session,
    files: {
      ...session.files,
      tabs: capTabList(session.files.tabs),
      views: capViews(session.files.views, session.files.tabs),
    },
  };
  scheduleWrite(PROJECT_STORE, session.project, capped);
}

async function read<T>(store: StoreName, key: string): Promise<T | null> {
  const db = await getDB();
  if (!db) return null;
  try {
    return ((await db.get(store, key)) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export function getTask(taskId: string): Promise<TaskWorkspaceSession | null> {
  return read<TaskWorkspaceSession>(TASK_STORE, taskId);
}

export function getProject(project: string): Promise<ProjectWorkspaceSession | null> {
  return read<ProjectWorkspaceSession>(PROJECT_STORE, project);
}

async function remove(store: StoreName, key: string): Promise<void> {
  const id = recordKey(store, key);
  const timer = pending.get(id);
  if (timer !== undefined) clearTimeout(timer);
  pending.delete(id);
  queue.delete(id);
  const db = await getDB();
  if (!db) return;
  try {
    await db.delete(store, key);
  } catch {
    // no-op
  }
}

export function deleteTask(taskId: string): Promise<void> {
  return remove(TASK_STORE, taskId);
}

export function deleteProject(project: string): Promise<void> {
  return remove(PROJECT_STORE, project);
}

/**
 * Cross-window invalidation. Returns an unsubscribe. A no-op when
 * `BroadcastChannel` is unavailable (older webviews, tests).
 */
export function subscribeSessionChanges(
  handler: (store: StoreName, key: string) => void,
): () => void {
  const bc = channel();
  if (!bc) return () => {};
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; store?: StoreName; key?: string } | null;
    if (data?.type !== "session-updated" || !data.store || !data.key) return;
    handler(data.store, data.key);
  };
  bc.addEventListener("message", onMessage);
  return () => bc.removeEventListener("message", onMessage);
}

/** Test hook: cancel timers and in-flight queues. Does not touch the DB. */
export function resetPendingForTests(): void {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
  queue.clear();
  lastSweep = 0;
}
