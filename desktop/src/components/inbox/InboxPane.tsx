import { CheckCheck, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import * as React from "react";

import { InboxDetailPane } from "@/components/inbox/InboxDetailPane";
import { InboxToolbar, PullRequestList } from "@/components/inbox/PullRequestList";
import { Button } from "@/components/ui/button";
import { useInboxPulls } from "@/hooks/useInboxUnseen";
import {
  applyInboxFilters,
  DEFAULT_INBOX_FILTERS,
  hasActiveInboxFilters,
  sortInboxItems,
  type InboxFilters,
} from "@/lib/inboxFilters";
import {
  inboxItemKey,
  markInboxItemSeen,
  markInboxItemsSeen,
  subscribeInboxSeen,
  unseenKeysSnapshot,
  type InboxSeenEntry,
} from "@/lib/inboxSeen";
import { isTypingTarget } from "@/lib/typingTarget";
import type { PullRequestSummary } from "@/protocol";
import { useUi } from "@/store/ui";

/**
 * The inbox as one pane: a list rail on the left, the selected pull request's
 * review filling everything to its right. Both inbox hosts — the
 * cross-project view and a project's Pull Requests tab — render this with a
 * different `projects` set, so their behaviours cannot drift.
 *
 * Opening a row marks it seen; "Mark all read" covers the rest. Unread state
 * is localStorage (`lib/inboxSeen`), so the sidebar badge and these dots are
 * always the same picture.
 *
 * `j`/`k` (and the arrow keys) walk the list without leaving the review, the
 * way every other code-review tool behaves.
 */
export function InboxPane({
  projects,
  onSendToAgent,
  emptyHint,
}: {
  /** Project names to read pull requests from. One project narrows the tab. */
  projects: readonly string[];
  /** Fired by the review pane's "Send to agent" action; the host owns creation. */
  onSendToAgent?: (project: string, prompt: string) => void;
  emptyHint?: string;
}) {
  const [filters, setFilters] = React.useState<InboxFilters>(DEFAULT_INBOX_FILTERS);
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null);
  const collapsed = useUi((s) => s.inboxListCollapsed);
  const toggleCollapsed = useUi((s) => s.toggleInboxListCollapsed);

  const listing = useInboxPulls(projects, filters);
  const items = React.useMemo(
    () => sortInboxItems(applyInboxFilters(listing.data ?? [], filters)),
    [listing.data, filters],
  );

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

  // The pane always shows something reviewable, but landing on the inbox is
  // not the same as having read the top row: seen state moves only when the
  // user picks a row themselves.
  const selected = items.find((pr) => inboxItemKey(pr) === selectedKey) ?? items[0] ?? null;

  const openPull = React.useCallback((pr: PullRequestSummary) => {
    markInboxItemSeen({ key: inboxItemKey(pr), updatedAt: pr.updatedAt });
    setSelectedKey(inboxItemKey(pr));
  }, []);

  const handleSendToAgent = React.useCallback(
    (pr: PullRequestSummary, prompt: string) => onSendToAgent?.(pr.project, prompt),
    [onSendToAgent],
  );

  const markAllSeen = React.useCallback(() => {
    markInboxItemsSeen(items.map((pr) => ({ key: inboxItemKey(pr), updatedAt: pr.updatedAt })));
  }, [items]);

  // Walk the list from anywhere in the surface. Steps are relative to what is
  // on screen, so a filtered list steps through the filtered rows only.
  React.useEffect(() => {
    if (items.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const step =
        event.key === "j" || event.key === "ArrowDown"
          ? 1
          : event.key === "k" || event.key === "ArrowUp"
            ? -1
            : 0;
      if (step === 0) return;
      event.preventDefault();
      const selectedNow = selected ? inboxItemKey(selected) : "";
      const current = items.findIndex((pr) => inboxItemKey(pr) === selectedNow);
      const next = items[Math.min(items.length - 1, Math.max(0, current + step))];
      if (next) openPull(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, openPull, selected]);

  if (projects.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-xs text-muted-foreground">
        Add a project to fill the inbox.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0">
      {collapsed ? (
        <div className="flex w-9 shrink-0 flex-col items-center border-r border-border/70 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground hover:text-foreground"
            aria-label="Show pull request list"
            title="Show pull request list"
            onClick={toggleCollapsed}
          >
            <PanelLeftOpen className="size-4" />
          </Button>
          {unseenKeys.size > 0 && (
            <span
              aria-label={`${unseenKeys.size} unread pull requests`}
              className="tnum mt-1 text-xs font-medium text-accent-foreground"
            >
              {unseenKeys.size}
            </span>
          )}
        </div>
      ) : (
        <div className="flex w-80 shrink-0 flex-col border-r border-border/70">
          <InboxToolbar
            search={filters.search}
            onSearch={(search) => setFilters((current) => ({ ...current, search }))}
            state={filters.state}
            onStateChange={(state) => setFilters((current) => ({ ...current, state }))}
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
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Hide pull request list"
              title="Hide pull request list"
              onClick={toggleCollapsed}
            >
              <PanelLeftClose className="size-4" />
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
              selectedKey={selected ? inboxItemKey(selected) : null}
              actions={{ onOpen: openPull }}
              isLoading={listing.isPending && !listing.isError}
              error={
                listing.isError
                  ? `Could not load pull requests: ${listing.error?.message}`
                  : undefined
              }
              emptyHint={emptyHint}
            />
          </div>
        </div>
      )}
      <div className="min-h-0 min-w-0 flex-1">
        <InboxDetailPane
          pr={selected}
          onSendToAgent={onSendToAgent ? handleSendToAgent : undefined}
        />
      </div>
    </div>
  );
}
