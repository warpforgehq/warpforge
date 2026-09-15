import { LegendList } from "@legendapp/list/react";
import { Inbox } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

import { BacklogRow, type BacklogRowActions } from "./BacklogRow";
import { BacklogRowSkeleton } from "./BacklogRowSkeleton";
import type { WorkItem } from "./types";

/** Matches the `h-9` row plus its border. */
export const ESTIMATED_ROW_HEIGHT = 37;

export interface BacklogListProps {
  items: WorkItem[];
  actions: BacklogRowActions;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  onEndReached: () => void;
  error?: string;
  /** Adds a work item by hand. The one action the emptiness can be fixed with. */
  onCreate?: () => void;
}

/**
 * The backlog as one scrolling list. Pages arrive by scrolling, so there is
 * no page to be on and no way to ask for one the rows do not already show —
 * the class of "pager moved, rows did not" bug the old table had cannot
 * happen here.
 */
export function BacklogList({
  items,
  actions,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  onEndReached,
  error,
  onCreate,
}: BacklogListProps) {
  const renderItem = React.useCallback(
    ({ item }: { item: WorkItem }) => <BacklogRow item={item} actions={actions} />,
    [actions],
  );
  const keyExtractor = React.useCallback((item: WorkItem) => item.id, []);

  if (error) {
    return <Message>{error}</Message>;
  }
  if (isLoading) {
    return (
      <div className="h-full min-w-0 overflow-x-hidden [overflow-anchor:none]">
        <BacklogRowSkeleton />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={Inbox}
          title="No work items yet"
          hint="Imported tracker items and anything you add by hand land here."
          action={
            onCreate && (
              <Button variant="outline" size="sm" onClick={onCreate}>
                Add work item
              </Button>
            )
          }
        />
      </div>
    );
  }

  return (
    <LegendList<WorkItem>
      data={items}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      estimatedItemSize={ESTIMATED_ROW_HEIGHT}
      recycleItems
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      className="h-full min-w-0 overflow-x-hidden [overflow-anchor:none]"
      ListFooterComponent={
        isFetchingNextPage ? (
          <BacklogRowSkeleton rows={1} />
        ) : hasNextPage ? null : (
          <div className="py-3 text-center text-[11px] text-muted-foreground/70">
            End of backlog
          </div>
        )
      }
    />
  );
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-4 py-8 text-center text-[13px] text-muted-foreground">
      {children}
    </div>
  );
}
