/**
 * The inbox's data layer: one query per (projects, filters) that polls every
 * half minute, shared by the sidebar badge and the inbox views. A pull
 * request's "unseen" is purely a localStorage question (`lib/inboxSeen`);
 * this hook only keeps the listing fresh enough for the answer to matter.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { daemon } from "@/daemon";
import { DEFAULT_INBOX_FILTERS, inboxFetchState, type InboxFilters } from "@/lib/inboxFilters";
import {
  inboxHasUnseenItems,
  inboxItemKey,
  inboxUnseenCount,
  seedInboxSeenIfNeeded,
  subscribeInboxSeen,
  type InboxSeenEntry,
} from "@/lib/inboxSeen";
import type { PullRequestSummary } from "@/protocol";

/** The badge keeps its own cadence; the views reuse the same cache. */
export const INBOX_POLL_MS = 30_000;

function projectsKey(projects: readonly string[]): string {
  return [...projects].sort().join(",");
}

export function inboxQueryKey(projects: readonly string[], filters: InboxFilters): unknown[] {
  return ["inbox", "pulls", projectsKey(projects), filters.state, filters.assignedToMe];
}

/**
 * Every registered project's open pull requests in one list. A project with
 * no GitHub remote (or a dead `gh` session) contributes nothing rather than
 * failing the whole inbox — the badge must not flicker off because one repo
 * is unreachable.
 */
export function useInboxPulls(
  projects: readonly string[],
  filters: InboxFilters = DEFAULT_INBOX_FILTERS,
): UseQueryResult<PullRequestSummary[]> {
  return useQuery({
    queryKey: inboxQueryKey(projects, filters),
    queryFn: async () => {
      const pages = await Promise.allSettled(
        projects.map((project) =>
          daemon.listPulls(project, {
            state: inboxFetchState(filters),
            assignedToMe: filters.assignedToMe,
            search: "",
            limit: 50,
          }),
        ),
      );
      const items: PullRequestSummary[] = [];
      let lastError: Error | null = null;
      for (const page of pages) {
        if (page.status === "fulfilled") items.push(...page.value);
        else
          lastError = page.reason instanceof Error ? page.reason : new Error(String(page.reason));
      }
      if (items.length === 0 && lastError && pages.length > 0) throw lastError;
      return items;
    },
    staleTime: INBOX_POLL_MS - 5_000,
    refetchInterval: INBOX_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

function seenEntries(items: readonly PullRequestSummary[]): InboxSeenEntry[] {
  return items.map((pr) => ({ key: inboxItemKey(pr), updatedAt: pr.updatedAt }));
}

/**
 * Whether any open pull request changed since the user last looked. Seeds
 * the baseline on first sight; re-checks whenever seen state moves, not just
 * when the listing does.
 */
export function useInboxUnseen(projects: readonly string[]): boolean {
  const query = useInboxPulls(projects);
  const [unseen, setUnseen] = useState(false);
  const items = useMemo(() => query.data ?? [], [query.data]);

  useEffect(() => {
    const entries = seenEntries(items);
    seedInboxSeenIfNeeded(entries);
    setUnseen(inboxHasUnseenItems(entries));
    return subscribeInboxSeen(() => {
      setUnseen(inboxHasUnseenItems(entries));
    });
  }, [items]);

  return unseen;
}

/** The badge's exact number, for the inbox nav row's count. */
export function useInboxUnseenCount(projects: readonly string[]): number {
  const query = useInboxPulls(projects);
  const [count, setCount] = useState(0);
  const items = useMemo(() => query.data ?? [], [query.data]);

  useEffect(() => {
    const entries = seenEntries(items);
    seedInboxSeenIfNeeded(entries);
    setCount(inboxUnseenCount(entries));
    return subscribeInboxSeen(() => {
      setCount(inboxUnseenCount(entries));
    });
  }, [items]);

  return count;
}
