import { CheckCheck } from "lucide-react";
import * as React from "react";

import { InboxToolbar, PullRequestList } from "@/components/inbox/PullRequestList";
import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { DEFAULT_INBOX_FILTERS, hasActiveInboxFilters } from "@/lib/inboxFilters";
import {
  assistantUnseenKeysSnapshot,
  inboxItemKey,
  markInboxItemsSeen,
  prAssistantSeenKey,
  subscribeInboxSeen,
  unseenKeysSnapshot,
  type InboxSeenEntry,
} from "@/lib/inboxSeen";
import {
  isPrAssistantRunning,
  prAssistantTaskIndex,
  prTaskTag,
  type PrAssistantState,
} from "@/lib/taskOrigin";

import { useInboxItems } from "./useInboxItems";

/**
 * "Which pull request": search, the open/all switch, mark-all-read and the
 * rows. Rendered as the sidebar's body while the Inbox view is active, and as
 * the list rail of a project's Pull Requests tab — one list, either column.
 *
 * Exactly one of these may be mounted at a time: the unread snapshot is cached
 * against the caller's `entries` array (`lib/inboxSeen`), and two callers would
 * evict each other's cache on every render.
 */
export function InboxListPane({
  projects,
  emptyHint,
}: {
  projects: readonly string[];
  emptyHint?: string;
}) {
  const { filters, items, listing, openPull, selected, setFilters } = useInboxItems(projects);

  const entries = React.useMemo<InboxSeenEntry[]>(
    () => items.map((pr) => ({ key: inboxItemKey(pr), updatedAt: pr.updatedAt })),
    [items],
  );
  // Storage is outside React, so the unread set is an external-store read. A
  // tick counter plus `useMemo` reads fine in tests but dies under React
  // Compiler: it memoizes on data flow, and `void tick` is not data flow.
  const unseenKeys = React.useSyncExternalStore(subscribeInboxSeen, () =>
    unseenKeysSnapshot(entries),
  );
  const markAllSeen = React.useCallback(() => markInboxItemsSeen(entries), [entries]);

  // One lookup map over the task snapshot, shared across every row's render.
  const tasks = React.useSyncExternalStore(
    daemon.subscribe,
    () => daemon.getState().snapshot.tasks,
  );
  const assistantByPr = prAssistantTaskIndex(tasks);
  const assistantEntries = React.useMemo(
    () =>
      items.flatMap((pr) => {
        const task = assistantByPr.get(prTaskTag(pr));
        if (!task || isPrAssistantRunning(task)) return [];
        return [{ key: prAssistantSeenKey(pr), updatedAt: task.updatedAt }];
      }),
    [assistantByPr, items],
  );
  const assistantUnseen = React.useSyncExternalStore(subscribeInboxSeen, () =>
    assistantUnseenKeysSnapshot(assistantEntries),
  );
  const assistantStates = React.useMemo(() => {
    const states = new Map<string, PrAssistantState>();
    for (const pr of items) {
      const task = assistantByPr.get(prTaskTag(pr));
      if (!task) continue;
      if (isPrAssistantRunning(task)) {
        states.set(inboxItemKey(pr), "running");
      } else if (assistantUnseen.has(prAssistantSeenKey(pr))) {
        states.set(inboxItemKey(pr), "unseen");
      }
    }
    return states;
  }, [assistantByPr, assistantUnseen, items]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <InboxToolbar
        search={filters.search}
        onSearch={(search) => setFilters({ ...filters, search })}
        state={filters.state}
        onStateChange={(state) => setFilters({ ...filters, state })}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          aria-label="Mark all pull requests as read"
          title="Mark all as read"
          disabled={unseenKeys.size === 0}
          onClick={markAllSeen}
        >
          <CheckCheck className="size-3.5" />
        </Button>
        {hasActiveInboxFilters(filters) && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setFilters(DEFAULT_INBOX_FILTERS)}
          >
            Reset
          </Button>
        )}
      </InboxToolbar>
      <div className="min-h-0 flex-1">
        <PullRequestList
          items={items}
          unseenKeys={unseenKeys}
          assistantStates={assistantStates}
          selectedKey={selected ? inboxItemKey(selected) : null}
          actions={{ onOpen: openPull }}
          isLoading={listing.isPending && !listing.isError}
          error={
            listing.isError ? `Could not load pull requests: ${listing.error?.message}` : undefined
          }
          emptyHint={emptyHint}
        />
      </div>
    </div>
  );
}
