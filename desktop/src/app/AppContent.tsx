import { Loader2 } from "lucide-react";
import { Suspense, lazy, useEffect } from "react";

import AppHeader from "@/components/AppHeader";
import ErrorBoundary from "@/components/ErrorBoundary";
import { SplitLine } from "@/components/titlebar/SplitLine";
import type { ConnectionState } from "@/daemon/types";
import { useTaskKeepersSync } from "@/hooks/useTaskKeepers";
import { useTaskPullRequestSync } from "@/hooks/useTaskPullRequest";
import { runOnIdle } from "@/lib/idle";
import type { Snapshot, TaskInfo } from "@/protocol";
import { type View, useUi } from "@/store/ui";

import type { NewTaskOptions } from "./dialogs";
import {
  loadAutomations,
  loadInboxView,
  loadMemory,
  loadNewTaskComposer,
  loadProjects,
  loadSettings,
  loadTaskDetail,
  loadTeam,
  prefetchRouteChunks,
} from "./routePrefetch";

const Automations = lazy(loadAutomations);
const InboxView = lazy(loadInboxView);
const Memory = lazy(loadMemory);
const NewTaskComposer = lazy(loadNewTaskComposer);
const Projects = lazy(loadProjects);
const SettingsView = lazy(loadSettings);
const TaskDetail = lazy(loadTaskDetail);
const Team = lazy(loadTeam);

export interface AppContentProps {
  snapshot: Snapshot;
  connection: ConnectionState;
  connectionError: string | null;
  view: View;
  openTask: TaskInfo | null;
  newTaskOpen: boolean;
  newTaskProject: string | null;
  newTaskPrompt: string | undefined;
  newTaskBacklogItemId: string | null;
  newTaskOptions?: NewTaskOptions;
  newTaskAddedProject?: string | null;
  onNewTaskOpenChange: (open: boolean) => void;
  onOpenTask: (id: string) => void;
  onCloseTask: () => void;
  onAddProject: () => void;
  onNewTask: (
    project?: string,
    prompt?: string,
    backlogItemId?: string,
    options?: NewTaskOptions,
  ) => void;
  onOpenPush: () => void;
  projectNames: string[];
  showPersistent: boolean;
  /** The sidebar panel is showing the Settings sections. */
  settingsNavInPanel?: boolean;
  /** The macOS window buttons sit over the title row's left end. */
  windowButtonsInset?: boolean;
}

/** The rounded surface under the title row that every view renders into. */
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-tl-lg border-l border-t border-border/70 bg-background">
        {children}
      </div>
    </div>
  );
}

export function AppContent({
  snapshot,
  connection,
  connectionError,
  view,
  openTask,
  newTaskOpen,
  newTaskProject,
  newTaskPrompt,
  newTaskBacklogItemId,
  newTaskOptions,
  newTaskAddedProject,
  onNewTaskOpenChange,
  onOpenTask,
  onCloseTask,
  onAddProject,
  onNewTask,
  onOpenPush,
  projectNames,
  showPersistent,
  windowButtonsInset = false,
  settingsNavInPanel = false,
}: AppContentProps) {
  // The route chunks are the only reason the Suspense fallback ever paints.
  // Once the daemon is up, load them on idle so the first visit to each view
  // renders from an already-warm chunk.
  useEffect(() => {
    if (connection !== "connected") return;
    return runOnIdle(prefetchRouteChunks);
  }, [connection]);
  useTaskPullRequestSync(connection);
  useTaskKeepersSync(connection);
  const sidebarMode = useUi((state) => state.sidebarMode);
  const sidebarCollapsed = useUi((state) => state.sidebarCollapsed);
  const settingsOpen = useUi((state) => state.settingsOpen);
  const closeSettings = useUi((state) => state.closeSettings);

  const panelScope = useUi((state) => state.panelScope);
  const scopeKey = panelScope
    ? panelScope.kind === "space"
      ? `space:${panelScope.id}`
      : `project:${panelScope.name}`
    : "all";
  const composing = newTaskOpen || (view === "start" && !openTask);
  const seededComposer =
    newTaskOpen &&
    Boolean(
      newTaskProject ||
      newTaskPrompt ||
      newTaskBacklogItemId ||
      newTaskOptions?.mode ||
      newTaskOptions?.factory,
    );
  const header = (
    <AppHeader
      view={view}
      openTask={openTask}
      snapshot={snapshot}
      windowButtonsInset={windowButtonsInset}
      composing={composing || settingsOpen}
      onOpenTask={onOpenTask}
      onCloseTask={onCloseTask}
    />
  );

  if (settingsOpen) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}
        <Card>
          <ErrorBoundary>
            <Suspense fallback={<LoadingNote />}>
              <SettingsView
                showNav={!settingsNavInPanel}
                snapshot={snapshot}
                onOpenTask={onOpenTask}
                onClose={closeSettings}
              />
            </Suspense>
          </ErrorBoundary>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {header}
      {openTask && !composing && <SplitLine />}
      <Card>
        <main
          className={
            composing || openTask
              ? "min-h-0 flex-1 overflow-hidden"
              : "min-h-0 flex-1 overflow-hidden p-2"
          }
        >
          <ErrorBoundary>
            <Suspense fallback={<LoadingNote />}>
              {connection !== "connected" ? (
                <div className="flex h-full items-center justify-center gap-2 text-[13px] text-muted-foreground/70">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  <span>
                    {connectionError && !connectionError.includes("daemon.json")
                      ? connectionError
                      : "Connecting to daemon…"}
                  </span>
                </div>
              ) : composing ? (
                <NewTaskComposer
                  key={seededComposer ? "seeded" : `composer:${scopeKey}`}
                  open
                  onOpenChange={onNewTaskOpenChange}
                  snapshot={snapshot}
                  defaultProject={newTaskOpen ? newTaskProject : null}
                  initialPrompt={newTaskOpen ? newTaskPrompt : undefined}
                  backlogItemId={newTaskOpen ? newTaskBacklogItemId : null}
                  initialMode={newTaskOpen ? newTaskOptions?.mode : undefined}
                  factorySeed={newTaskOpen ? newTaskOptions?.factory : undefined}
                  onCreated={newTaskOpen ? newTaskOptions?.onCreated : undefined}
                  noProjectRequest={newTaskOpen && newTaskOptions?.chat ? newTaskOptions : null}
                  onAddProject={onAddProject}
                  addedProject={newTaskAddedProject}
                />
              ) : openTask ? (
                <TaskDetail
                  key={openTask.id}
                  task={openTask}
                  snapshot={snapshot}
                  onOpenTask={onOpenTask}
                  onOpenPush={onOpenPush}
                />
              ) : view === "project" ? (
                <Projects
                  snapshot={snapshot}
                  onOpenTask={onOpenTask}
                  onNewTask={onNewTask}
                  onAddProject={onAddProject}
                  sectionPicker={!showPersistent || sidebarCollapsed}
                />
              ) : view === "inbox" ? (
                <InboxView
                  projects={projectNames}
                  onSendToAgent={(project, prompt) => onNewTask(project, prompt)}
                  onAddProject={onAddProject}
                  listInSidebar={showPersistent && sidebarMode === "inbox"}
                />
              ) : view === "automations" ? (
                <Automations
                  snapshot={snapshot}
                  onOpenTask={onOpenTask}
                  listInSidebar={showPersistent && !sidebarCollapsed}
                />
              ) : view === "memory" ? (
                <Memory snapshot={snapshot} onOpenTask={onOpenTask} />
              ) : (
                <Team snapshot={snapshot} onOpenTask={onOpenTask} onNewTask={onNewTask} />
              )}
            </Suspense>
          </ErrorBoundary>
        </main>
      </Card>
    </div>
  );
}

function LoadingNote() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-[13px] text-muted-foreground/70">
      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
      <span>Loading…</span>
    </div>
  );
}
