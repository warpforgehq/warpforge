/**
 * Which inbox items the user has already looked at, kept in localStorage.
 *
 * A PR is unseen when its `updatedAt` differs from the recorded one — a new
 * comment, a new review, a force-push all move the timestamp, and none of
 * them need anything fancier than "this row changed since I looked". The
 * first-ever sighting of the inbox seeds silently, so a new install doesn't
 * light the badge for every PR that ever existed.
 */

export interface InboxSeenEntry {
  key: string;
  updatedAt: number;
}

const STORAGE_KEY = "wf-inbox-seen-v1";
const CHANGE_EVENT = "wf:inbox-seen";

/** Stable identity of one pull request across refreshes. */
export function inboxItemKey(pr: { repo: string; number: number }): string {
  return `${pr.repo}#${pr.number}`;
}

function loadAll(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const seen: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) seen[key] = value;
    }
    return seen;
  } catch {
    return {};
  }
}

function saveAll(seen: Record<string, number>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // Private mode / quota — unseen tracking degrades to "always unseen".
  }
  version += 1;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Bumped on every write so a `useSyncExternalStore` snapshot can be cached
 * between changes; see `unseenKeysSnapshot`.
 */
let version = 0;

let unseenCache: {
  entries: InboxSeenEntry[];
  value: ReadonlySet<string>;
  version: number;
} | null = null;

/**
 * The keys of `entries` that are unseen right now, cached against the storage
 * version and the caller's array. React requires a stable snapshot out of
 * `useSyncExternalStore`, and React Compiler memoizes render reads on data
 * flow alone — a tick counter smuggled through `void` does not re-run the
 * read. This is the sanctioned path.
 */
export function unseenKeysSnapshot(entries: InboxSeenEntry[]): ReadonlySet<string> {
  const cached = unseenCache;
  if (cached && cached.version === version && cached.entries === entries) return cached.value;
  const value = new Set(entries.filter((entry) => isInboxEntryUnseen(entry)).map((e) => e.key));
  unseenCache = { entries, value, version };
  return value;
}

/** Notify subscribers (e.g. the sidebar dot) that seen state moved. */
export function subscribeInboxSeen(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/**
 * Record the first listing without marking anything unread: on the very first
 * poll there is no baseline, and lighting the badge for work that predates
 * the feature would read as a bug.
 */
export function seedInboxSeenIfNeeded(entries: InboxSeenEntry[]) {
  if (entries.length === 0) return;
  if (Object.keys(loadAll()).length > 0) return;
  const seen: Record<string, number> = {};
  for (const entry of entries) seen[entry.key] = entry.updatedAt;
  saveAll(seen);
}

export function markInboxItemSeen(entry: InboxSeenEntry) {
  const seen = loadAll();
  if (seen[entry.key] === entry.updatedAt) return;
  seen[entry.key] = entry.updatedAt;
  saveAll(seen);
}

export function markInboxItemsSeen(entries: InboxSeenEntry[]) {
  const seen = loadAll();
  let changed = false;
  for (const entry of entries) {
    if (seen[entry.key] !== entry.updatedAt) {
      seen[entry.key] = entry.updatedAt;
      changed = true;
    }
  }
  if (changed) saveAll(seen);
}

export function isInboxEntryUnseen(entry: InboxSeenEntry): boolean {
  return loadAll()[entry.key] !== entry.updatedAt;
}

export function inboxHasUnseenItems(entries: InboxSeenEntry[]): boolean {
  const seen = loadAll();
  return entries.some((entry) => seen[entry.key] !== entry.updatedAt);
}

export function inboxUnseenCount(entries: InboxSeenEntry[]): number {
  const seen = loadAll();
  return entries.reduce((count, entry) => count + (seen[entry.key] === entry.updatedAt ? 0 : 1), 0);
}
