/**
 * Which files of a pull request the reviewer has ticked off, in localStorage.
 *
 * This is the reviewer's own bookkeeping, not a fact about the PR: it says
 * "I have read this file", and a new push or a new comment does not un-read
 * it. That is deliberately unlike `lib/inboxSeen`, which tracks whether the
 * PR moved since you last looked — mixing the two would clear a reviewer's
 * progress every time somebody commented.
 *
 * A mark is scoped to the version of the file it was made against — its
 * `fingerprintPatchFile`, below — not just its path. GitHub clears a file's
 * own viewed checkbox the moment that file's diff changes; without the same
 * rule here, a mark from an earlier push silently applied to today's version
 * of the file and folded it away unread. `-v2` retires the earlier shape (a
 * plain path list, no fingerprint) so a device carrying marks from before
 * this rule existed reopens every PR unmarked rather than lying about which
 * files were actually read.
 *
 * Per-device, so nothing here needs a daemon or a schema.
 */

import type { PatchFileBlock } from "@/lib/pullDiff";

const STORAGE_KEY = "wf-pull-viewed-v2";
const CHANGE_EVENT = "wf:pull-viewed";

/** path -> the fingerprint of the file version it was marked against. */
type PullMarks = Record<string, string>;

/**
 * A cheap fingerprint of one file's patch content, so a mark can be tied to
 * the version of the file it was made against. GitHub clears a file's own
 * viewed checkbox the moment that file's diff changes; the daemon hands us
 * the raw patch and nothing that plays the role of a per-file revision id,
 * so hashing the hunks already parsed out of it is what is available.
 * FNV-1a over kind+text catches a same-length edit that plain +/- counts
 * would miss.
 */
export function fingerprintPatchFile(block: PatchFileBlock): string {
  const text = block.hunks
    .map(
      (hunk) =>
        `${hunk.header}\n${hunk.lines.map((line) => `${line.kind}:${line.text}`).join("\n")}`,
    )
    .join("\n");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * The marks this session is working with.
 *
 * Memory is the source of truth and storage is written through best-effort,
 * not the other way round. A WebView that refuses `localStorage` (private
 * mode, a partitioned origin, a full quota) used to make the whole feature
 * lie: the file folded away because that is React state, while the checkbox
 * and the "3/10 viewed" counter re-read storage, found nothing, and sat at
 * zero. Persistence is worth having and worth losing quietly; the tick you
 * just made is not.
 */
let cache: Record<string, PullMarks> | null = null;

/**
 * Bumped on every write, so a UI reading marks through `useSyncExternalStore`
 * can cache its snapshot between changes. The subscriber list and the version
 * together are the store; reading storage per render is what the version avoids.
 */
let version = 0;

let snapshotCache: {
  fingerprints: ReadonlyMap<string, string>;
  pr: string;
  value: ReadonlySet<string>;
  version: number;
} | null = null;

/** Stable identity of one pull request, matching `lib/inboxSeen`. */
export function pullViewedKey(pr: { repo: string; number: number }): string {
  return `${pr.repo}#${pr.number}`;
}

function loadAll(): Record<string, PullMarks> {
  cache ??= readStorage();
  return cache;
}

function readStorage(): Record<string, PullMarks> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const viewed: Record<string, PullMarks> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null) continue;
      const marks: PullMarks = {};
      for (const [path, fingerprint] of Object.entries(value as Record<string, unknown>)) {
        if (typeof fingerprint === "string") marks[path] = fingerprint;
      }
      viewed[key] = marks;
    }
    return viewed;
  } catch {
    return {};
  }
}

function saveAll(viewed: Record<string, PullMarks>) {
  cache = viewed;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(viewed));
  } catch {
    // Storage is a convenience here: the marks live on in `cache` for this
    // session, they just will not survive a reload.
  }
  version += 1;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Tests only: drop the in-memory copy so storage is read again. */
export function resetPullViewedCache() {
  cache = null;
  version += 1;
}

/** Notify subscribers (the progress counter, the file rail) of a change. */
export function subscribePullViewed(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/**
 * Paths marked viewed *and still at the fingerprint they were marked at*.
 * `fingerprints` is the caller's current patch, path -> fingerprint — a mark
 * for a path the diff no longer carries, or whose fingerprint moved on,
 * drops out here rather than being reported as viewed.
 */
export function viewedPaths(
  pr: string,
  fingerprints: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const marks = loadAll()[pr] ?? {};
  const paths = new Set<string>();
  for (const [path, fingerprint] of Object.entries(marks)) {
    if (fingerprints.get(path) === fingerprint) paths.add(path);
  }
  return paths;
}

/**
 * `viewedPaths` for a live component: same answer, but the result is cached
 * against the version and the caller's inputs, so repeated calls between
 * writes return one set. React requires that of a `useSyncExternalStore`
 * snapshot — a fresh set per call would send it into an endless re-render —
 * and React Compiler memoizes render reads on data flow alone, so a tick
 * counter smuggled through `void` does not work. This is the sanctioned path.
 */
export function viewedPathsSnapshot(
  pr: string,
  fingerprints: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const cached = snapshotCache;
  if (
    cached &&
    cached.version === version &&
    cached.pr === pr &&
    cached.fingerprints === fingerprints
  ) {
    return cached.value;
  }
  const value = viewedPaths(pr, fingerprints);
  snapshotCache = { fingerprints, pr, value, version };
  return value;
}

export function isPullFileViewed(pr: string, path: string, fingerprint: string): boolean {
  return (loadAll()[pr] ?? {})[path] === fingerprint;
}

export function setPullFileViewed(pr: string, path: string, fingerprint: string, viewed: boolean) {
  const all = loadAll();
  const current = all[pr] ?? {};
  const has = current[path] === fingerprint;
  if (viewed === has) return;
  const next = { ...current };
  if (viewed) next[path] = fingerprint;
  else delete next[path];
  // Re-inserting moves this pull request to the end, which is what makes the
  // cap evict the least recently touched one rather than an arbitrary one.
  delete all[pr];
  if (Object.keys(next).length > 0) all[pr] = next;
  saveAll(evictOldest(all));
}

/**
 * Cap how many pull requests carry marks.
 *
 * Every reviewed PR leaves an entry behind for good, and this is somebody's
 * browser storage, not ours to fill: a year of reviews is thousands of dead
 * entries for PRs that merged long ago. Insertion order is the age order —
 * `setPullFileViewed` re-inserts on every write — so the front of the object
 * is the least recently touched, and that is what goes.
 */
const MAX_TRACKED_PULLS = 100;

function evictOldest(all: Record<string, PullMarks>): Record<string, PullMarks> {
  const keys = Object.keys(all);
  if (keys.length <= MAX_TRACKED_PULLS) return all;
  const kept: Record<string, PullMarks> = {};
  for (const key of keys.slice(keys.length - MAX_TRACKED_PULLS)) kept[key] = all[key];
  return kept;
}

export function clearPullViewed(pr: string) {
  const all = loadAll();
  if (!(pr in all)) return;
  delete all[pr];
  saveAll(all);
}
