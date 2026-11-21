import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { useRunnerStatus } from "@/hooks/useRunner";
import type { RunnerEntry } from "@/protocol";
import { useUi } from "@/store/ui";

import { BacklogList } from "./BacklogList";
import type { BacklogRowActions } from "./BacklogRow";
import { BacklogToolbar } from "./BacklogToolbar";
import { TrackerSyncPill } from "./TrackerSyncPill";
import { type BacklogParams, DEFAULT_BACKLOG_PARAMS, toWorkItem, type WorkItem } from "./types";
import { useProjectSources } from "./use-tracker";

/**
 * ADR-0002: opening a project pulls its trackers once, gated by a staleness
 * window, and the Sync button is that same query refetched — so an automatic
 * pull and a manual refresh can never race into duplicate imports.
 */
const SYNC_STALE_MS = 5 * 60_000;

interface BacklogViewProps {
  project: string;
  onStartTask?: (item: WorkItem) => void;
  onOpenTask?: (taskId: string) => void;
  /** Set of task IDs the daemon still knows about. */
  liveTaskIds?: ReadonlySet<string>;
  /** Row click: opens the item's details. */
  onOpenItem?: (item: WorkItem) => void;
  /** Adds a work item by hand. */
  onCreate?: () => void;
  /** Opens New Task in Factory mode for items; enables row selection. */
  onStartInFactory?: (items: WorkItem[]) => void;
  /** Opens the Factory batch form, with the selected items offered. */
  onRunInFactory?: (selected: WorkItem[]) => void;
}

export function BacklogView({
  project,
  onStartTask,
  onOpenTask,
  liveTaskIds,
  onOpenItem,
  onCreate,
  onStartInFactory,
  onRunInFactory,
}: BacklogViewProps) {
  const queryClient = useQueryClient();
  const [selection, setSelection] = React.useState<Map<string, WorkItem>>(() => new Map());
  const toggleSelect = React.useCallback((item: WorkItem) => {
    setSelection((current) => {
      const next = new Map(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  }, []);
  const selectedIds = React.useMemo(() => new Set(selection.keys()), [selection]);

  // Sorting and filtering are the daemon's job, so one object holds the whole
  // request and doubles as the query key. It lives in the UI store, per
  // project and persisted: how you read a board is a stance you hold, not
  // something to restate on every visit.
  const params = useUi((state) => state.backlogParamsByProject[project]) ?? DEFAULT_BACKLOG_PARAMS;
  const patchParams = useUi((state) => state.patchBacklogParams);
  const resetParams = useUi((state) => state.resetBacklogParams);

  /** Any change starts the listing over — the key changes, so page 0 is refetched. */
  const patch = React.useCallback(
    (next: Partial<BacklogParams>) => patchParams(project, next),
    [patchParams, project],
  );
  const reset = React.useCallback(() => resetParams(project), [project, resetParams]);

  // Names accumulate as rows load, so they are per project and reset with it —
  // in the same render as the switch, not in an effect that would first offer
  // the previous project's people.
  const [seen, setSeen] = React.useState<{ project: string; names: string[] }>({
    project,
    names: [],
  });
  if (seen.project !== project) setSeen({ project, names: [] });
  const seenAssignees = seen.names;

  // One pull per project: the same listing adopts new issues, refreshes the
  // tracked ones and drops deleted ones. The local list renders without
  // waiting for it and is invalidated when it lands.
  const sync = useQuery({
    queryKey: ["backlog", project, "sync"],
    queryFn: async () => {
      const imported = await daemon.importExternalWorkItems(project);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["backlog", project, "list"] }),
        queryClient.invalidateQueries({ queryKey: ["backlog", project, "count"] }),
      ]);
      return imported;
    },
    staleTime: SYNC_STALE_MS,
    retry: false,
  });
  React.useEffect(() => {
    if (sync.error) {
      toast.error("Could not sync backlog", { description: sync.error.message });
    }
  }, [sync.error]);

  const list = useInfiniteQuery({
    queryKey: ["backlog", project, "list", params],
    queryFn: ({ pageParam }) =>
      daemon.listBacklog({
        project,
        page: pageParam,
        pageSize: params.pageSize,
        sortBy: params.sortBy,
        sortDesc: params.sortDesc,
        search: params.search,
        status: params.status ?? undefined,
        source: params.source ?? undefined,
        priority: params.priority ?? undefined,
        assignee: params.assignee ?? undefined,
      }),
    initialPageParam: 0,
    // The daemon reports whether more rows exist; trust that rather than
    // comparing counts, which a concurrent import would make wrong.
    getNextPageParam: (lastPage) => (lastPage.hasNextPage ? lastPage.page + 1 : undefined),
    staleTime: 10_000,
  });

  const sources = useProjectSources(project);
  const hasTracker = !sources.data || sources.data.github || sources.data.linear;
  // The pull's rows land through a list refetch, so the note stays until that
  // refetch has painted them, not just until the pull itself answers.
  const refreshing = sync.isFetching || (list.isFetching && !list.isFetchingNextPage);
  const showSyncPill = refreshing && !list.isPending && hasTracker;

  const [manualSyncing, setManualSyncing] = React.useState(false);
  const syncNow = React.useCallback(async () => {
    setManualSyncing(true);
    try {
      // The same query the mount ran, so a manual pull and the automatic one
      // cannot race; it invalidates the list itself when it lands.
      await queryClient.refetchQueries({ queryKey: ["backlog", project, "sync"] });
    } finally {
      setManualSyncing(false);
    }
  }, [project, queryClient]);

  const items = React.useMemo(
    () => (list.data?.pages ?? []).flatMap((page) => page.items.map(toWorkItem)),
    [list.data],
  );

  // Names accumulate rather than being derived from `items`, because `items`
  // is the *filtered* listing: reading the options out of it meant picking one
  // assignee narrowed the rows, which then emptied the list of everyone else.
  React.useEffect(() => {
    setSeen((current) => {
      const merged = new Set(current.names);
      for (const item of items) if (item.assignee) merged.add(item.assignee);
      return merged.size === current.names.length
        ? current
        : { project: current.project, names: [...merged].sort((a, b) => a.localeCompare(b)) };
    });
  }, [items]);

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = list;
  const loadMore = React.useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const runner = useRunnerStatus(onStartInFactory ? project : "");
  const factory = React.useMemo(() => {
    const byItem = new Map<string, RunnerEntry>();
    for (const entry of runner.data?.entries ?? []) {
      if (entry.itemId) byItem.set(entry.itemId, entry);
    }
    return byItem;
  }, [runner.data]);

  const actions = React.useMemo<BacklogRowActions>(
    () => ({
      onOpen: (item) => onOpenItem?.(item),
      onOpenTask,
      onStartTask,
      liveTaskIds,
      onStartInFactory: onStartInFactory && ((item) => onStartInFactory([item])),
      factory,
      onToggleSelect: onStartInFactory && toggleSelect,
      selected: selectedIds,
    }),
    [
      onOpenItem,
      onOpenTask,
      onStartTask,
      liveTaskIds,
      onStartInFactory,
      factory,
      toggleSelect,
      selectedIds,
    ],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <BacklogToolbar
        project={project}
        params={params}
        onChange={patch}
        onReset={reset}
        onSync={() => void syncNow()}
        isSyncing={sync.isFetching || manualSyncing}
        assignees={seenAssignees}
        onRunInFactory={onRunInFactory && (() => onRunInFactory([...selection.values()]))}
      />
      {onStartInFactory && selection.size > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-rule bg-secondary/40 px-3 text-[12px]">
          <span className="tnum text-muted-foreground">{selection.size} selected</span>
          <Button
            size="sm"
            className="h-7 px-2.5 text-[12px]"
            onClick={() => {
              onStartInFactory([...selection.values()]);
              setSelection(new Map());
            }}
          >
            Start {selection.size} in Factory
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[12px]"
            onClick={() => setSelection(new Map())}
          >
            Clear
          </Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <BacklogList
          items={items}
          actions={actions}
          isLoading={list.isPending && !list.isError}
          isFetchingNextPage={isFetchingNextPage}
          hasNextPage={hasNextPage}
          onEndReached={loadMore}
          error={list.isError ? `Could not load backlog: ${list.error.message}` : undefined}
          onCreate={onCreate}
        />
        {showSyncPill && <TrackerSyncPill sources={sources.data} />}
      </div>
    </div>
  );
}
