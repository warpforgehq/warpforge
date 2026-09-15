import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Panel, PanelGroup, PanelSeparator } from "@/components/ui/panels";
import { TooltipProvider } from "@/components/ui/tooltip";
import { daemon } from "@/daemon";
import { HAS_NATIVE_GLASS, IS_MAC } from "@/lib/platform";
import {
  type GlobalView,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  useUi,
} from "@/store/ui";

import { AppContent } from "./app/AppContent";
import { AppOverlays } from "./app/AppOverlays";
import { useAppDialogs } from "./app/dialogs";
import { getConnection, getConnectionError, getSnapshot, LiveSidebar } from "./app/hosts";
import { useShellShortcuts } from "./app/shortcuts";
import { useDaemonEvents } from "./hooks/useDaemonEvents";
import { useFontScaling } from "./hooks/useFontScaling";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { usePullShortcut } from "./hooks/usePullShortcut";
import { usePushShortcut } from "./hooks/usePushShortcut";
import { useTheme } from "./hooks/useTheme";
import { queryClient } from "./query";

/** Icon-rail width when the sidebar is collapsed. */
const SIDEBAR_COLLAPSED_WIDTH = 64;

export default function App() {
  const snapshot = useSyncExternalStore(daemon.subscribe, getSnapshot);
  const connection = useSyncExternalStore(daemon.subscribe, getConnection);
  const connectionError = useSyncExternalStore(daemon.subscribe, getConnectionError);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const openProject = useUi((s) => s.openProject);
  const openTaskId = useUi((s) => s.openTaskId);
  const setOpenTaskId = useUi((s) => s.openTask);
  const lastTaskId = useUi((s) => s.lastTaskId);
  const selectTasksSegment = useUi((s) => s.selectTasksSegment);
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const setSidebarWidth = useUi((s) => s.setSidebarWidth);
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUi((s) => s.toggleSidebarCollapsed);
  const isWide = useMediaQuery("(min-width: 1024px)");
  const showPersistent = isWide;
  const dialogs = useAppDialogs();
  const {
    newTaskOpen,
    setNewTaskOpen,
    setPushOpen,
    setAddProjectOpen,
    setSettingsOpen,
    startNewTask,
  } = dialogs;

  useFontScaling();
  useTheme();
  const transparentWindow = useUi((s) => s.transparentWindow);
  useDaemonEvents();

  const handleOpenTask = (id: string) => {
    setNewTaskOpen(false);
    setOpenTaskId(id);
  };

  const handleSelectView = (nextView: GlobalView) => {
    setNewTaskOpen(false);
    setView(nextView);
  };

  // The remembered task is offered, never resurrected blind: one deleted while
  // the app was closed would otherwise reopen from storage. An empty task list
  // before the first handshake proves nothing, so the id is only dropped once
  // the snapshot has actually loaded and shows the task is gone.
  const handleSelectTasksSegment = () => {
    setNewTaskOpen(false);
    const snapshotLoaded = connection === "connected" || snapshot.tasks.length > 0;
    const remembered =
      snapshotLoaded && lastTaskId && !snapshot.tasks.some((t) => t.id === lastTaskId)
        ? null
        : lastTaskId;
    selectTasksSegment(remembered);
  };

  const handleOpenProject = (name: string) => {
    setNewTaskOpen(false);
    openProject(name);
  };

  const openTask = snapshot.tasks.find((t) => t.id === openTaskId) ?? null;

  const settleFinishedTurns = useCallback((ids: string[]) => {
    for (const id of ids) {
      daemon.request("task.settle", { task_id: id }).catch(() => {});
    }
  }, []);

  const deleteSettledShelf = useCallback(async (project: string) => {
    const result = await daemon.deleteSettledTasks(project);
    toast(`Deleted ${result.deleted} finished task${result.deleted === 1 ? "" : "s"}`, {
      description:
        result.kept > 0
          ? `${result.kept} kept — worktree still has uncommitted changes`
          : undefined,
    });
  }, []);

  const projectNames = useMemo(
    () => snapshot.projects.map((project) => project.name),
    [snapshot.projects],
  );
  usePullShortcut(snapshot.tasks);
  usePushShortcut(snapshot.tasks, setPushOpen);
  useShellShortcuts(startNewTask, toggleSidebarCollapsed);

  const sidebarProps = {
    collapsed: sidebarCollapsed,
    connection,
    connectionError,
    onNewTask: () => startNewTask(),
    onOpenSettings: () => setSettingsOpen(true),
    onSettleFinishedTurns: settleFinishedTurns,
    onDeleteSettledShelf: deleteSettledShelf,
    onOpenTask: handleOpenTask,
    onSelectView: handleSelectView,
    onSelectTasksSegment: handleSelectTasksSegment,
    onOpenProject: handleOpenProject,
    onAddProject: () => setAddProjectOpen(true),
    onToggleCollapsed: toggleSidebarCollapsed,
    openTaskId,
    view,
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300} skipDelayDuration={0}>
        {/* Prototype shell: full-height sidebar beside a column of topbar + content. */}
        <div
          className={`flex h-screen flex-col ${
            HAS_NATIVE_GLASS && transparentWindow ? "bg-transparent" : "bg-background"
          }`}
        >
          {/* The overlay title bar puts the traffic lights over the content, so
              macOS reserves a strip for them — and it is the drag handle the
              hidden native title bar no longer provides. */}
          {IS_MAC && <div data-tauri-drag-region="deep" className="h-7 shrink-0" />}
          <div className="relative flex min-h-0 flex-1">
            {/* One shape whatever the sidebar is doing: moving the content
                column between branches remounts every view under it, editors
                and chat included. Collapsing narrows the panel instead. */}
            <PanelGroup orientation="horizontal" className="h-full min-h-0">
              {showPersistent && (
                <Panel
                  key="sidebar"
                  size={sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth}
                  minSize={SIDEBAR_WIDTH_MIN}
                  maxSize={SIDEBAR_WIDTH_MAX}
                  defaultSize={SIDEBAR_WIDTH_DEFAULT}
                  onSizeChange={setSidebarWidth}
                  className="min-w-0"
                >
                  <aside
                    className="flex h-full min-h-0 flex-col overflow-hidden"
                    data-testid="persistent-sidebar"
                  >
                    <LiveSidebar {...sidebarProps} />
                  </aside>
                </Panel>
              )}
              {showPersistent && (
                // Kept mounted while collapsed so the panel does not grow its
                // own edge grip and make the icon rail draggable.
                <PanelSeparator
                  key="sidebar-separator"
                  aria-label="Resize sidebar"
                  aria-hidden={sidebarCollapsed || undefined}
                  tabIndex={sidebarCollapsed ? -1 : 0}
                  data-testid={sidebarCollapsed ? undefined : "sidebar-resize-handle"}
                  className={sidebarCollapsed ? "pointer-events-none opacity-0" : undefined}
                />
              )}
              <Panel key="content" pin className="min-w-0">
                <AppContent
                  snapshot={snapshot}
                  connection={connection}
                  connectionError={connectionError}
                  view={view}
                  openTask={openTask}
                  newTaskOpen={newTaskOpen}
                  newTaskProject={dialogs.newTaskProject}
                  newTaskPrompt={dialogs.newTaskPrompt}
                  newTaskBacklogItemId={dialogs.newTaskBacklogItemId}
                  onNewTaskOpenChange={setNewTaskOpen}
                  onOpenTask={setOpenTaskId}
                  onCloseTask={() => setOpenTaskId(null)}
                  onAddProject={() => setAddProjectOpen(true)}
                  onNewTask={startNewTask}
                  onOpenPush={() => setPushOpen(true)}
                  projectNames={projectNames}
                  showPersistent={showPersistent}
                />
              </Panel>
            </PanelGroup>

            <AppOverlays
              dialogs={dialogs}
              snapshot={snapshot}
              openTask={openTask}
              openTaskId={openTask ? openTask.id : null}
              hasOpenTask={!!openTask && !newTaskOpen}
              projects={projectNames}
            />
          </div>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
