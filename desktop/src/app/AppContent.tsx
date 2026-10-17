import { Loader2 } from "lucide-react";
import { Suspense, lazy, useEffect, useSyncExternalStore } from "react";

import AppHeader from "@/components/AppHeader";
import ErrorBoundary from "@/components/ErrorBoundary";
import { daemon } from "@/daemon";
import type { ConnectionState } from "@/daemon/types";
import { useTaskPullRequestSync } from "@/hooks/useTaskPullRequest";
import { runOnIdle } from "@/lib/idle";
import type { Snapshot, TaskInfo } from "@/protocol";
import { type View, useUi } from "@/store/ui";

import type { NewTaskOptions } from "./dialogs";
import {
  loadAutomations,
  loadInboxView,
  loadMemory,
  loadMissionControl,
  loadProjects,
  loadTaskDetail,
  loadTeam,
  prefetchRouteChunks,
} from "./routePrefetch";

const Automations = lazy(loadAutomations);
const InboxView = lazy(loadInboxView);
const Memory = lazy(loadMemory);
const MissionControl = lazy(loadMissionControl);
const NewTaskDialog = lazy(() => import("../views/NewTaskDialog"));
const Projects = lazy(loadProjects);
const TaskDetail = lazy(loadTaskDetail);
const Team = lazy(loadTeam);

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
  onNewTaskOpenChange,
  onOpenTask,
  onCloseTask,
  onAddProject,
  onNewTask,
  onOpenPush,
  projectNames,
  showPersistent,
}: AppContentProps) {
  // The route chunks are the only reason the Suspense fallback ever paints.
  // Once the daemon is up, load them on idle so the first visit to each view
  // renders from an already-warm chunk.
  useEffect(() => {
    if (connection !== "connected") return;
    return runOnIdle(prefetchRouteChunks);
  }, [connection]);
  useTaskPullRequestSync(connection);
  const sidebarMode = useUi((state) => state.sidebarMode);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!newTaskOpen && (
        <AppHeader
          view={view}
          openTask={openTask}
          onAddProject={onAddProject}
          onCloseTask={onCloseTask}
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
              <div className="flex h-full items-center justify-center gap-2 text-[13px] text-muted-foreground/70">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <span>Loading…</span>
              </div>
            }
          >
            {connection !== "connected" ? (
              <div className="flex h-full items-center justify-center gap-2 text-[13px] text-muted-foreground/70">
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
                onOpenChange={onNewTaskOpenChange}
                snapshot={snapshot}
                defaultProject={newTaskProject}
                initialPrompt={newTaskPrompt}
                backlogItemId={newTaskBacklogItemId}
                initialMode={newTaskOptions?.mode}
                factorySeed={newTaskOptions?.factory}
                onCreated={newTaskOptions?.onCreated}
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
              />
            ) : view === "inbox" ? (
              <InboxView
                projects={projectNames}
                onSendToAgent={(project, prompt) => onNewTask(project, prompt)}
                onAddProject={onAddProject}
                listInSidebar={showPersistent && sidebarMode === "inbox"}
              />
            ) : view === "automations" ? (
              <Automations snapshot={snapshot} onOpenTask={onOpenTask} />
            ) : view === "memory" ? (
              <Memory snapshot={snapshot} onOpenTask={onOpenTask} />
            ) : view === "team" ? (
              <Team snapshot={snapshot} onOpenTask={onOpenTask} onNewTask={onNewTask} />
            ) : (
              <LiveMissionControl onOpenTask={onOpenTask} onNewTask={onNewTask} />
            )}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
