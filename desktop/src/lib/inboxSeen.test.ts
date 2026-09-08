import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  inboxHasUnseenItems,
  inboxItemKey,
  inboxUnseenCount,
  isInboxEntryUnseen,
  markInboxItemSeen,
  markInboxItemsSeen,
  seedInboxSeenIfNeeded,
  subscribeInboxSeen,
} from "./inboxSeen";

const entry = (key: string, updatedAt: number) => ({ key, updatedAt });
const pr = (repo: string, number: number, updatedAt: number) => ({
  key: inboxItemKey({ repo, number }),
  updatedAt,
});

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("inboxSeen", () => {
  it("sees a PR whose updatedAt moved since the last look", () => {
    markInboxItemSeen(pr("acme/widgets", 7, 100));
    expect(isInboxEntryUnseen(pr("acme/widgets", 7, 100))).toBe(false);
    expect(isInboxEntryUnseen(pr("acme/widgets", 7, 200))).toBe(true);
    expect(isInboxEntryUnseen(pr("acme/widgets", 7, 50))).toBe(true);
  });

  it("seeds the first listing silently instead of lighting the badge", () => {
    seedInboxSeenIfNeeded([pr("acme/widgets", 1, 10), pr("acme/widgets", 2, 20)]);
    expect(inboxHasUnseenItems([pr("acme/widgets", 1, 10)])).toBe(false);
    expect(inboxHasUnseenItems([pr("acme/widgets", 2, 21)])).toBe(true);
  });

  it("never seeds over an existing baseline", () => {
    markInboxItemSeen(pr("acme/widgets", 1, 10));
    // A second project appears later: seeding again must not mark its PRs read.
    seedInboxSeenIfNeeded([pr("acme/widgets", 1, 10), pr("other/thing", 5, 99)]);
    expect(inboxUnseenCount([pr("other/thing", 5, 99)])).toBe(1);
  });

  it("marks many rows at once and reports how many are unseen", () => {
    markInboxItemsSeen([pr("a/r", 1, 1), pr("a/r", 2, 2)]);
    expect(inboxUnseenCount([pr("a/r", 1, 1), pr("a/r", 2, 3), pr("a/r", 3, 4)])).toBe(2);
  });

  it("notifies subscribers when seen state moves", () => {
    const listener = vi.fn<() => void>();
    const unsubscribe = subscribeInboxSeen(listener);
    markInboxItemSeen(pr("a/r", 1, 1));
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    // Marking an already-seen entry is not a change and stays quiet.
    markInboxItemSeen(pr("a/r", 1, 1));
    expect(listener).not.toHaveBeenCalled();
  });

  it("survives corrupt storage rather than throwing", () => {
    window.localStorage.setItem("wf-inbox-seen-v1", "{not json");
    expect(inboxHasUnseenItems([entry("a", 1)])).toBe(true);
    markInboxItemSeen(entry("a", 1));
    expect(isInboxEntryUnseen(entry("a", 1))).toBe(false);
  });
});
