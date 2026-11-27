import { FolderGit2 } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import type { NewTaskOptions } from "@/app/dialogs";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { boardTasks } from "@/lib/taskOrigin";
import { disposeTerminalWorkspace } from "@/lib/terminalWorkspace";
import { DEFAULT_PROJECT_SURFACE, useUi } from "@/store/ui";

import { BacklogView } from "../components/backlog/BacklogView";
import { NewWorkItemDrawer } from "../components/backlog/NewWorkItemDrawer";
import type { WorkItem } from "../components/backlog/types";
import { WorkItemDrawer } from "../components/backlog/WorkItemDrawer";
import { TerminalWorkspaceView } from "../components/runtime/TerminalWorkspace";
import { daemon } from "../daemon";
import type { ServiceInfo, Snapshot } from "../protocol";
import { FactorySettingsDialog } from "./projects/FactorySettingsDialog";
import { PortRangeConflictCard } from "./projects/PortRangeStatus";
import { ProjectFilesSurface } from "./projects/ProjectFilesSurface";
import { ProjectRuntimeSurface } from "./projects/ProjectRuntimeSurface";
import { ProjectTitleBar } from "./projects/ProjectTitleBar";
import { PullRequestSurface } from "./projects/PullRequestSurface";
import { type ProjectLiveCounts, RemoveProjectDialog } from "./projects/RemoveProjectDialog";
import { WorktreesSurface } from "./projects/WorktreesSurface";

interface Props {
  snapshot: Snapshot;
  onOpenTask: (id: string) => void;
  onNewTask: (
    project?: string,
    prompt?: string,
    backlogItemId?: string,
    options?: NewTaskOptions,
  ) => void;
  onAddProject?: () => void;
  /** The sidebar panel is hidden, so the title row offers the sections. */
  sectionPicker?: boolean;
}

/**
 * A project section, full size. The panel's project mode lists the sections;
 * the title row carries the section's name and actions.
 */
export default function Projects({
  snapshot,
  onOpenTask,
  onNewTask,
  onAddProject,
  sectionPicker = false,
}: Props) {
  const selectedProjectId = useUi((state) => state.selectedProjectId);
  const openProject = useUi((state) => state.openProject);
  const setView = useUi((state) => state.setView);
  const [removeProject, setRemoveProject] = useState<string | null>(null);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [openItem, setOpenItem] = useState<WorkItem | null>(null);
  const [factorySettings, setFactorySettings] = useState<string | null>(null);
  const [stoppingAll, setStoppingAll] = useState<string | null>(null);

  const project =
    snapshot.projects.find((p) => p.name === selectedProjectId) ?? snapshot.projects[0] ?? null;
  const projectName = project?.name ?? "";
  /* Hooks below run before the `if (!project)` guard, so nothing here may
     dereference `project`: with an empty registry it is undefined at runtime,
     which TS misses because indexing `projects[0]` is not typed as optional. */
  const declaredServices = useMemo(() => project?.declaredServices ?? [], [project]);
  const surface = useUi(
    (state) => state.projectSurfaceByProject[projectName] ?? DEFAULT_PROJECT_SURFACE,
  );
  const clearProjectState = useUi((state) => state.clearProjectState);
  const services = useMemo(
    () => snapshot.services.filter((s) => s.project === projectName),
    [snapshot.services, projectName],
  );
  const runtimeServices = useMemo(() => {
    const knownNames = new Set(services.map((service) => service.name));
    const missingDeclaredServices = declaredServices.flatMap((name): ServiceInfo[] =>
      knownNames.has(name)
        ? []
        : [
            {
              allocatedPort: 0,
              command: "",
              logSeq: 0,
              name,
              originalPort: 0,
              project: projectName,
              status: "stopped",
            },
          ],
    );
    return [...services, ...missingDeclaredServices];
  }, [declaredServices, projectName, services]);
  const pfs = useMemo(
    () => snapshot.portforwards.filter((pf) => pf.project === projectName),
    [snapshot.portforwards, projectName],
  );

  const removeLiveCounts = useMemo<ProjectLiveCounts>(() => {
    if (!removeProject) return { services: 0, portforwards: 0, terminals: 0 };
    return {
      services: snapshot.services.filter(
        (service) =>
          service.project === removeProject &&
          (service.status === "running" || service.status === "starting"),
      ).length,
      portforwards: snapshot.portforwards.filter(
        (forward) =>
          forward.project === removeProject &&
          (forward.status === "active" ||
            forward.status === "starting" ||
            forward.status === "restarting"),
      ).length,
      terminals: snapshot.terminals.filter((terminal) => terminal.project === removeProject).length,
    };
  }, [removeProject, snapshot.portforwards, snapshot.services, snapshot.terminals]);

  const linkedTask = useMemo(
    () => snapshot.tasks.find((task) => task.id === openItem?.taskId) ?? null,
    [openItem?.taskId, snapshot.tasks],
  );
  const liveTaskIds = useMemo(
    () => new Set(boardTasks(snapshot.tasks).map((task) => task.id)),
    [snapshot.tasks],
  );

  const startTaskFromItem = useCallback(
    (item: WorkItem) => {
      setOpenItem(null);
      onNewTask(item.project, [item.title, item.body].filter(Boolean).join("\n\n"), item.id);
    },
    [onNewTask],
  );

  const startInFactory = useCallback(
    async (items: WorkItem[]) => {
      setOpenItem(null);
      const [first] = items;
      if (!first) return;
      if (items.length > 1) {
        onNewTask(first.project, undefined, undefined, {
          factory: { items },
          mode: "factory",
        });
        return;
      }
      // The daemon words the prompt, so tracker text arrives inside the
      // untrusted block exactly as the Factory hands it to agents.
      const prompt = await daemon
        .runnerBrief(first.project, first.id)
        .catch(() => [first.title, first.body].filter(Boolean).join("\n\n"));
      onNewTask(first.project, prompt, first.id, { mode: "factory" });
    },
    [onNewTask],
  );

  const openTaskFromItem = useCallback(
    (taskId: string) => {
      setOpenItem(null);
      onOpenTask(taskId);
    },
    [onOpenTask],
  );

  const confirmProjectRemoval = useCallback(async () => {
    if (!removeProject) return;
    const remainingProjects = snapshot.projects.filter((item) => item.name !== removeProject);
    await daemon.removeProject(removeProject, true);
    disposeTerminalWorkspace(removeProject);
    clearProjectState(removeProject);
    setRemoveProject(null);
    if (selectedProjectId !== removeProject) return;
    const next = remainingProjects[0]?.name;
    // Nothing left to be the subject of this view, and no nav item to fall
    // back to: the app has to leave the project page entirely.
    if (next) openProject(next);
    else setView("start");
  }, [
    clearProjectState,
    openProject,
    removeProject,
    selectedProjectId,
    setView,
    snapshot.projects,
  ]);

  if (!project) {
    return (
      <EmptyState
        className="mt-16"
        icon={FolderGit2}
        title="No projects registered"
        hint="Run wf add <path>, or add one below."
        action={
          <Button variant="outline" onClick={onAddProject}>
            <FolderGit2 className="mr-1 size-4" />
            Add Project
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <ProjectTitleBar
        project={project}
        section={surface}
        sectionPicker={sectionPicker}
        onSection={(next) => openProject(project.name, next)}
        onNewWorkItem={() => setBacklogOpen(true)}
        onFactorySettings={() => setFactorySettings(project.name)}
        onStopAll={() => setStoppingAll(project.name)}
        onRemove={() => setRemoveProject(project.name)}
      />
      {project.portRangeConflict && (
        <div className="shrink-0 px-1 pb-2">
          <PortRangeConflictCard project={project} />
        </div>
      )}

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {surface === "files" ? (
          <ProjectFilesSurface project={project.name} rootPath={project.path} />
        ) : surface === "terminal" ? (
          <TerminalWorkspaceView key={project.name} project={project.name} />
        ) : surface === "runtime" ? (
          <ProjectRuntimeSurface
            project={project.name}
            services={runtimeServices}
            portforwards={pfs}
            localConfigError={project.localConfigError}
            onAppendToChat={(context) => onNewTask(project.name, context.body)}
          />
        ) : surface === "worktrees" ? (
          <WorktreesSurface project={project.name} />
        ) : surface === "pulls" ? (
          <PullRequestSurface
            project={project.name}
            onSendToAgent={(sendProject, prompt) => onNewTask(sendProject, prompt)}
          />
        ) : (
          <div className="h-full">
            <BacklogView
              key={project.name}
              project={project.name}
              liveTaskIds={liveTaskIds}
              onOpenTask={onOpenTask}
              onOpenItem={setOpenItem}
              onStartTask={startTaskFromItem}
              onStartInFactory={(items) => void startInFactory(items)}
              onCreate={() => setBacklogOpen(true)}
            />
          </div>
        )}
      </div>

      <RemoveProjectDialog
        project={removeProject}
        liveCounts={removeLiveCounts}
        onCancel={() => setRemoveProject(null)}
        onConfirm={confirmProjectRemoval}
      />

      <FactorySettingsDialog
        project={factorySettings}
        agents={snapshot.agents ?? []}
        onClose={() => setFactorySettings(null)}
      />

      <ConfirmDialog
        open={stoppingAll !== null}
        title="Stop all Factory tasks?"
        description="Running Factory tasks in this project stop, and queued ones are removed. Their work so far stays where it is."
        confirmLabel="Stop all"
        busyLabel="Stopping…"
        onCancel={() => setStoppingAll(null)}
        onConfirm={async () => {
          if (stoppingAll) await daemon.runnerStop(stoppingAll);
          setStoppingAll(null);
        }}
      />

      <NewWorkItemDrawer open={backlogOpen} onOpenChange={setBacklogOpen} project={project.name} />

      <WorkItemDrawer
        item={openItem}
        linkedTask={linkedTask}
        onClose={() => setOpenItem(null)}
        onStartTask={startTaskFromItem}
        onStartInFactory={(item) => void startInFactory([item])}
        onOpenTask={openTaskFromItem}
      />
    </div>
  );
}
