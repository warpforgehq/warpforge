import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearPullViewed,
  resetPullViewedCache,
  isPullFileViewed,
  pullViewedKey,
  setPullFileViewed,
  subscribePullViewed,
  viewedPaths,
} from "./pullViewed";

const PR = pullViewedKey({ repo: "acme/widgets", number: 7 });
const FP_A = "fp-a-v1";
const FP_B = "fp-b-v1";

/** A one-file fingerprint map, the shape `viewedPaths` expects. */
function fingerprints(entries: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(entries));
}

describe("pullViewed", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPullViewedCache();
  });

  it("keys a pull request the same way the seen map does", () => {
    expect(PR).toBe("acme/widgets#7");
  });

  it("remembers a ticked file and forgets it again", () => {
    setPullFileViewed(PR, "src/a.ts", FP_A, true);
    expect(isPullFileViewed(PR, "src/a.ts", FP_A)).toBe(true);
    setPullFileViewed(PR, "src/a.ts", FP_A, false);
    expect(isPullFileViewed(PR, "src/a.ts", FP_A)).toBe(false);
  });

  it("keeps each pull request's marks apart", () => {
    const other = pullViewedKey({ repo: "acme/widgets", number: 8 });
    setPullFileViewed(PR, "src/a.ts", FP_A, true);
    expect(isPullFileViewed(other, "src/a.ts", FP_A)).toBe(false);
  });

  it("reports every viewed path of one pull request", () => {
    setPullFileViewed(PR, "src/a.ts", FP_A, true);
    setPullFileViewed(PR, "src/b.ts", FP_B, true);
    const paths = viewedPaths(PR, fingerprints({ "src/a.ts": FP_A, "src/b.ts": FP_B }));
    expect([...paths].sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("does not write twice for the same mark", () => {
    const listener = vi.fn<() => void>();
    const stop = subscribePullViewed(listener);
    setPullFileViewed(PR, "src/a.ts", FP_A, true);
    setPullFileViewed(PR, "src/a.ts", FP_A, true);
    stop();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clears a pull request's progress", () => {
    setPullFileViewed(PR, "src/a.ts", FP_A, true);
    clearPullViewed(PR);
    expect(viewedPaths(PR, fingerprints({ "src/a.ts": FP_A })).size).toBe(0);
  });

  it("survives a corrupt store rather than throwing", () => {
    window.localStorage.setItem("wf-pull-viewed-v2", "{not json");
    expect(viewedPaths(PR, fingerprints({ "src/a.ts": FP_A })).size).toBe(0);
  });

  it("stops tracking the least recently touched pull requests", () => {
    // Somebody's storage, not ours to fill: a year of reviews would otherwise
    // leave thousands of entries for pull requests that merged long ago.
    for (let number = 1; number <= 105; number += 1) {
      setPullFileViewed(pullViewedKey({ repo: "acme/widgets", number }), "src/a.ts", FP_A, true);
    }
    const stored = JSON.parse(window.localStorage.getItem("wf-pull-viewed-v2") ?? "{}") as Record<
      string,
      unknown
    >;
    expect(Object.keys(stored)).toHaveLength(100);
    expect(stored["acme/widgets#1"]).toBeUndefined();
    expect(stored["acme/widgets#105"]).toBeDefined();
  });

  it("keeps a pull request it is still touching", () => {
    const kept = pullViewedKey({ repo: "acme/widgets", number: 1 });
    setPullFileViewed(kept, "src/a.ts", FP_A, true);
    for (let number = 2; number <= 100; number += 1) {
      setPullFileViewed(pullViewedKey({ repo: "acme/widgets", number }), "src/a.ts", FP_A, true);
    }
    // Touching it again moves it off the eviction end.
    setPullFileViewed(kept, "src/b.ts", FP_A, true);
    for (let number = 101; number <= 110; number += 1) {
      setPullFileViewed(pullViewedKey({ repo: "acme/widgets", number }), "src/a.ts", FP_A, true);
    }
    expect(isPullFileViewed(kept, "src/b.ts", FP_A)).toBe(true);
  });

  it("still reports a mark storage refused to keep", () => {
    const setItem = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    setPullFileViewed(PR, "src/a.ts", FP_A, true);
    // The tick the reviewer just made must not vanish because the WebView
    // would not persist it; only the reload survives it.
    expect(isPullFileViewed(PR, "src/a.ts", FP_A)).toBe(true);
    setItem.mockRestore();
  });

  it("does not count a mark made against an earlier version of the file", () => {
    setPullFileViewed(PR, "src/a.ts", FP_A, true);
    // The file changed since — same path, a new fingerprint — so the old
    // mark must not silently carry over onto the file as it stands now.
    expect(isPullFileViewed(PR, "src/a.ts", FP_B)).toBe(false);
    expect(viewedPaths(PR, fingerprints({ "src/a.ts": FP_B })).size).toBe(0);
  });
});
