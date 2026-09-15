import { useQueryClient } from "@tanstack/react-query";
import { type ComponentProps, useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { FindInFiles, FIND_LIMIT } from "@/components/FindInFiles";
import { LANGUAGE_SERVERS_QUERY_KEY } from "@/components/LanguageServersPanel";
import { QuickOpen } from "@/components/QuickOpen";
import Sidebar from "@/components/Sidebar";
import { daemon } from "@/daemon";
import {
  AGENT_UPDATE_POLL_MS,
  agentUpdatesQueryKey,
  useAgentUpdates,
} from "@/hooks/useAgentUpdates";
import { useFindInFilesShortcut } from "@/hooks/useFindInFilesShortcut";
import { usePrAssistantLifecycle } from "@/hooks/usePrAssistantLifecycle";
import { useQuickOpenShortcut } from "@/hooks/useQuickOpenShortcut";
import { runOnIdle } from "@/lib/idle";
import { ensureTask, setTaskFind } from "@/lib/sessionStore";
import type { FileDoc, SymbolMatch } from "@/protocol";
import { useProjectFileListQuery } from "@/query";
import { useUi } from "@/store/ui";

export const getSnapshot = () => daemon.getState().snapshot;
export const getConnection = () => daemon.getState().connection;
export const getConnectionError = () => daemon.getState().connectionError;
export const getPendingAgentSetup = () => daemon.getState().pendingAgentSetup;

export function LiveSidebar(props: Omit<ComponentProps<typeof Sidebar>, "state">) {
  const state = useSyncExternalStore(daemon.subscribe, daemon.getState);
  return <Sidebar state={state} {...props} />;
}

/**
 * Retires a PR Assistant conversation when its pull request is done with.
 *
 * A component rather than a hook call in `App`: it reads the inbox listing
 * through React Query, and `App` renders above the provider. Every project,
 * because a listing scoped to one says nothing about the others.
 */
export function PrAssistantLifecycleHost({ projects }: { projects: string[] }) {
  usePrAssistantLifecycle(projects);
  return null;
}

/**
 * Owns the agent-package version poll for the whole app, so an out-of-date
 * agent CLI reaches the sidebar dot without anyone opening Settings. A
 * component for the same reason as `PrAssistantLifecycleHost`.
 */
export function AgentUpdatesHost() {
  useAgentUpdates();
  return null;
}

/**
 * Warms the two Settings detections the user would otherwise watch paint a
 * skeleton. Both shell out and take seconds; on idle after the daemon connects,
 * the cache already holds the answer the page will read. Keys already in cache
 * are skipped, and the agent key is the same one `AgentUpdatesHost` polls.
 */
export function SettingsPrefetchHost() {
  const connection = useSyncExternalStore(daemon.subscribe, getConnection);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (connection !== "connected") return;
    return runOnIdle(() => {
      if (queryClient.getQueryData(LANGUAGE_SERVERS_QUERY_KEY) === undefined) {
        void queryClient.prefetchQuery({
          queryKey: LANGUAGE_SERVERS_QUERY_KEY,
          queryFn: () => daemon.detectLanguageServers(),
          staleTime: 5 * 60_000,
        });
      }
      if (queryClient.getQueryData(agentUpdatesQueryKey) === undefined) {
        void queryClient.prefetchQuery({
          queryKey: agentUpdatesQueryKey,
          queryFn: () => daemon.detectAgents(),
          staleTime: AGENT_UPDATE_POLL_MS - 5_000,
        });
      }
    });
  }, [connection, queryClient]);
  return null;
}

/** The stored Find-in-Files session for a task, if the snapshot still has it. */
function findSessionFor(taskId: string | null) {
  if (!taskId) return null;
  const info = daemon.getState().snapshot.tasks.find((task) => task.id === taskId);
  if (!info) return null;
  return ensureTask(info.id, info.project, info.worktree ?? undefined).findInFiles;
}

/** Hosts the search palettes: owns the file-list query, the search RPCs and the
 *  double-Shift / ⌘⇧F triggers. Rendered as a child of the QueryClientProvider
 *  so its hook sees the client (App's own hooks must not query — they'd render
 *  before the provider). */
export function QuickOpenHost({
  openTaskId,
  hasOpenTask,
}: {
  openTaskId: string | null;
  hasOpenTask: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findInitial, setFindInitial] = useState("");
  const [findInitialIndex, setFindInitialIndex] = useState(0);
  const filesQuery = useProjectFileListQuery(hasOpenTask ? openTaskId : null);
  const openTaskThroughNav = useUi((s) => s.openTaskWithNav);
  useQuickOpenShortcut(() => {
    if (hasOpenTask) setOpen(true);
  });
  useFindInFilesShortcut(() => {
    if (!hasOpenTask) return;
    const session = findSessionFor(openTaskId);
    setFindInitial(session?.query ?? "");
    setFindInitialIndex(session?.activeIndex ?? 0);
    setFindOpen(true);
  });

  const searchProject = useCallback(
    (query: string) =>
      daemon.request("file.search", {
        limit: FIND_LIMIT,
        query,
        task_id: openTaskId,
      }) as Promise<SymbolMatch[]>,
    [openTaskId],
  );
  const loadFile = useCallback(
    (path: string) =>
      (daemon.request("file.contents", { path, task_id: openTaskId }) as Promise<FileDoc>).then(
        (doc) => doc.newText,
      ),
    [openTaskId],
  );
  const openAt = useCallback(
    (path: string, location?: { line: number; column: number }) => {
      if (openTaskId) openTaskThroughNav(openTaskId, { surface: "files", path, ...location });
    },
    [openTaskId, openTaskThroughNav],
  );
  const persistFind = useCallback(
    (session: { query: string; activeIndex: number }) => {
      if (!openTaskId) return;
      const info = daemon.getState().snapshot.tasks.find((task) => task.id === openTaskId);
      if (!info) return;
      setTaskFind(
        info.id,
        info.project,
        { ...session, updatedAt: Date.now() },
        info.worktree ?? undefined,
      );
    },
    [openTaskId],
  );

  return (
    <>
      <QuickOpen
        open={open}
        files={filesQuery.data ?? []}
        loading={filesQuery.isLoading}
        error={filesQuery.error?.message ?? null}
        onSearch={searchProject}
        onPick={openAt}
        onClose={() => setOpen(false)}
      />
      <FindInFiles
        open={findOpen}
        onSearch={searchProject}
        loadFile={loadFile}
        onPick={(path, line, column) => openAt(path, { column, line })}
        onClose={() => setFindOpen(false)}
        initialQuery={findInitial}
        initialActiveIndex={findInitialIndex}
        onSessionChange={persistFind}
      />
    </>
  );
}
