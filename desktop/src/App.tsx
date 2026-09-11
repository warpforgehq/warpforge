import { QueryClientProvider } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";

import AppHeader from "@/components/AppHeader";
import AttentionToast from "@/components/AttentionToast";
import BootstrapWizard from "@/components/BootstrapWizard";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import ErrorBoundary from "@/components/ErrorBoundary";
import { FindInFiles, FIND_LIMIT } from "@/components/FindInFiles";
import { QuickOpen } from "@/components/QuickOpen";
import Sidebar from "@/components/Sidebar";
import { Panel, PanelGroup, PanelSeparator } from "@/components/ui/panels";
import { TooltipProvider } from "@/components/ui/tooltip";
import { daemon } from "@/daemon";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { HAS_NATIVE_GLASS, IS_MAC } from "@/lib/platform";
import { SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, useUi } from "@/store/ui";

import { useDaemonEvents } from "./hooks/useDaemonEvents";
import { useFindInFilesShortcut } from "./hooks/useFindInFilesShortcut";
import { useFontScaling } from "./hooks/useFontScaling";
import { usePrAssistantLifecycle } from "./hooks/usePrAssistantLifecycle";
import { usePullShortcut } from "./hooks/usePullShortcut";
import { usePushShortcut } from "./hooks/usePushShortcut";
import { useQuickOpenShortcut } from "./hooks/useQuickOpenShortcut";
import { useTauriClose } from "./hooks/useTauriClose";
import { useTheme } from "./hooks/useTheme";
import type { FileDoc, SymbolMatch } from "./protocol";
import { queryClient, useProjectFileListQuery } from "./query";
const AddProjectDialog = lazy(() => import("./views/AddProjectDialog"));
const AgentSetupDialog = lazy(() => import("./views/AgentSetupDialog"));
const Automations = lazy(() => import("./views/Automations"));
const InboxView = lazy(() => import("./views/InboxView"));
const MissionControl = lazy(() => import("./views/MissionControl"));
const NewTaskDialog = lazy(() => import("./views/NewTaskDialog"));
const Projects = lazy(() => import("./views/Projects"));
const PushDialog = lazy(() => import("./views/PushDialog"));
const SettingsView = lazy(() => import("./views/settings"));
const TaskDetail = lazy(() => import("./views/TaskDetail"));

function LiveMissionControl({
  onOpenTask,
  onNewTask,
}: {
  onOpenTask: (id: string) => void;
  onNewTask: (project?: string, prompt?: string) => void;
}) {
  const state = useSyncExternalStore(daemon.subscribe, daemon.getState);
  return <MissionControl state={state} onOpenTask={onOpenTask} onNewTask={onNewTask} />;
}

function LiveSidebar(props: Omit<React.ComponentProps<typeof Sidebar>, "state">) {
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
function PrAssistantLifecycleHost({ projects }: { projects: string[] }) {
  usePrAssistantLifecycle(projects);
  return null;
}

/** Hosts the search palettes: owns the file-list query, the search RPCs and the
 *  double-Shift / ⌘⇧F triggers. Rendered as a child of the QueryClientProvider
 *  so its hook sees the client (App's own hooks must not query — they'd render
 *  before the provider). */
function QuickOpenHost({
  openTaskId,
  hasOpenTask,
}: {
  openTaskId: string | null;
  hasOpenTask: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const filesQuery = useProjectFileListQuery(hasOpenTask ? openTaskId : null);
  const openTaskThroughNav = useUi((s) => s.openTaskWithNav);
  useQuickOpenShortcut(() => {
    if (hasOpenTask) setOpen(true);
  });
  useFindInFilesShortcut(() => {
    if (hasOpenTask) setFindOpen(true);
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
      />
    </>
  );
}

const getSnapshot = () => daemon.getState().snapshot;
const getConnection = () => daemon.getState().connection;
const getConnectionError = () => daemon.getState().connectionError;
const getPendingAgentSetup = () => daemon.getState().pendingAgentSetup;

/** Icon-rail width when the sidebar is collapsed. */
const SIDEBAR_COLLAPSED_WIDTH = 64;

export default function App() {
  const snapshot = useSyncExternalStore(daemon.subscribe, getSnapshot);
  const connection = useSyncExternalStore(daemon.subscribe, getConnection);
  const connectionError = useSyncExternalStore(daemon.subscribe, getConnectionError);
  const pendingAgentSetup = useSyncExternalStore(daemon.subscribe, getPendingAgentSetup);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const openProject = useUi((s) => s.openProject);
  const openTaskId = useUi((s) => s.openTaskId);
  const setOpenTaskId = useUi((s) => s.openTask);
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const setSidebarWidth = useUi((s) => s.setSidebarWidth);
  const sidebarCollapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useUi((s) => s.toggleSidebarCollapsed);
  const isWide = useMediaQuery("(min-width: 1024px)");
  const showPersistent = isWide;
  const [newTaskProject, setNewTaskProject] = useState<string | null>(null);
  const [newTaskPrompt, setNewTaskPrompt] = useState<string | undefined>(undefined);
  // Set when the new-task surface was opened from a backlog item, so the
  // created task can be linked back to it.
  const [newTaskBacklogItemId, setNewTaskBacklogItemId] = useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [wizardProject, setWizardProject] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useFontScaling();
  useTheme();
  const transparentWindow = useUi((s) => s.transparentWindow);
  useDaemonEvents();
  const pendingQuit = useTauriClose();

  const handleOpenTask = (id: string) => {
    setNewTaskOpen(false);
    setOpenTaskId(id);
  };

  const handleSelectView = (nextView: typeof view) => {
    setNewTaskOpen(false);
    setView(nextView);
  };

  const handleOpenProject = (name: string) => {
    setNewTaskOpen(false);
    openProject(name);
  };

  const openTask = snapshot.tasks.find((t) => t.id === openTaskId) ?? null;

  const startNewTask = useCallback((project?: string, prompt?: string, backlogItemId?: string) => {
    setNewTaskProject(project ?? null);
    setNewTaskPrompt(prompt);
    setNewTaskBacklogItemId(backlogItemId ?? null);
    setNewTaskOpen(true);
  }, []);

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

  const handleProjectAdded = useCallback(
    (name: string) => {
      openProject(name);
      toast("Project added", {
        description: `Run the setup wizard for ${name}`,
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Open wizard",
          onClick: () => setWizardProject(name),
        },
      });
    },
    [openProject],
  );

  // The sidebar advertises ⌘N next to New task, so the shortcut lives here
  // rather than inside the sidebar, which is unmounted while it is closed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "n") return;
      event.preventDefault();
      startNewTask();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [startNewTask]);

  const projectNames = useMemo(
    () => snapshot.projects.map((project) => project.name),
    [snapshot.projects],
  );
  usePullShortcut(snapshot.tasks);
  usePushShortcut(snapshot.tasks, setPushOpen);

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
    onOpenProject: handleOpenProject,
    onToggleCollapsed: toggleSidebarCollapsed,
    openTaskId,
    view,
  };
  const contentColumn = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!newTaskOpen && (
        <AppHeader
          view={view}
          openTask={openTask}
          onAddProject={() => setAddProjectOpen(true)}
          onCloseTask={() => setOpenTaskId(null)}
        />
      )}
      <main
        className={
          newTaskOpen ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-hidden p-2"
        }
      >
        <ErrorBoundary>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground/70">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <span>Loading…</span>
              </div>
            }
          >
            {connection !== "connected" ? (
              <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground/70">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <span>
                  {connectionError && !connectionError.includes("daemon.json")
                    ? connectionError
                    : "Connecting to daemon…"}
                </span>
              </div>
            ) : newTaskOpen ? (
              <NewTaskDialog
                open
                onOpenChange={setNewTaskOpen}
                snapshot={snapshot}
                defaultProject={newTaskProject}
                initialPrompt={newTaskPrompt}
                backlogItemId={newTaskBacklogItemId}
              />
            ) : openTask ? (
              <TaskDetail
                key={openTask.id}
                task={openTask}
                snapshot={snapshot}
                onOpenTask={setOpenTaskId}
                onOpenPush={() => setPushOpen(true)}
              />
            ) : view === "control" ? (
              <LiveMissionControl onOpenTask={setOpenTaskId} onNewTask={startNewTask} />
            ) : view === "inbox" ? (
              <InboxView
                projects={projectNames}
                onSendToAgent={(project, prompt) => startNewTask(project, prompt)}
              />
            ) : view === "automations" ? (
              <Automations snapshot={snapshot} onOpenTask={setOpenTaskId} />
            ) : (
              <Projects
                snapshot={snapshot}
                onOpenTask={setOpenTaskId}
                onNewTask={startNewTask}
                onAddProject={() => setAddProjectOpen(true)}
              />
            )}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
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
                {contentColumn}
              </Panel>
            </PanelGroup>

            {pushOpen && <PushDialog open onOpenChange={setPushOpen} task={openTask} />}
            <QuickOpenHost
              openTaskId={openTask ? openTask.id : null}
              hasOpenTask={!!openTask && !newTaskOpen}
            />
            <PrAssistantLifecycleHost projects={projectNames} />
            {addProjectOpen && (
              <AddProjectDialog
                open
                onOpenChange={setAddProjectOpen}
                onAdded={handleProjectAdded}
              />
            )}
            <SettingsView open={settingsOpen} onOpenChange={setSettingsOpen} />
            {pendingQuit && (
              <ConfirmDialog
                open
                title="Stop running services and quit?"
                description={
                  <>
                    Still running: {pendingQuit.services.join(", ")}
                    {pendingQuit.more > 0 ? `, and ${pendingQuit.more} more` : ""}. Quitting stops
                    them.
                  </>
                }
                confirmLabel="Stop & quit"
                busyLabel="Stopping…"
                onCancel={pendingQuit.cancel}
                onConfirm={pendingQuit.confirm}
              />
            )}
            {pendingAgentSetup && (
              <AgentSetupDialog
                detected={pendingAgentSetup}
                onClose={() => {
                  daemon.dismissAgentSetup();
                }}
              />
            )}
            {wizardProject && (
              <BootstrapWizard
                project={wizardProject}
                agents={snapshot.agents ?? []}
                open={!!wizardProject}
                onOpenChange={(v) => {
                  if (!v) setWizardProject(null);
                }}
                onStarted={(taskId) => {
                  const projectName = wizardProject;
                  setWizardProject(null);
                  const toastId = `bootstrap:${taskId}`;
                  toast.custom(
                    (sonnerId) => (
                      <AttentionToast
                        title="Config generation started"
                        identity={projectName ?? "project"}
                        summary="Agent is writing .warpforge.yaml in background"
                        onDismiss={() => toast.dismiss(sonnerId)}
                        onOpen={() => {
                          useUi.getState().openTask(taskId);
                          toast.dismiss(sonnerId);
                        }}
                      />
                    ),
                    {
                      action: null,
                      cancel: null,
                      description: null,
                      duration: 10_000,
                      icon: null,
                      id: toastId,
                      richColors: false,
                      unstyled: true,
                    },
                  );
                }}
              />
            )}
          </div>
        </div>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
