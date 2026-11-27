import { useMemo } from "react";
import { create } from "zustand";

import { daemon } from "@/daemon";
import { disposeTerminalWorkspace } from "@/lib/terminalWorkspace";
import type { Snapshot } from "@/protocol";
import { useUi } from "@/store/ui";

import { type ProjectLiveCounts, RemoveProjectDialog } from "./RemoveProjectDialog";

/** The project the Remove project dialog is asking about. Transient. */
export const useRemoveProject = create<{
  project: string | null;
  open: (project: string) => void;
  close: () => void;
}>()((set) => ({
  project: null,
  open: (project) => set({ project }),
  close: () => set({ project: null }),
}));

/**
 * The one Remove project confirmation, opened from the project menu or the
 * sidebar's context menu. Removing the project on screen moves to the next one.
 */
export function RemoveProjectHost({ snapshot }: { snapshot: Snapshot }) {
  const project = useRemoveProject((s) => s.project);
  const close = useRemoveProject((s) => s.close);

  const liveCounts = useMemo<ProjectLiveCounts>(() => {
    if (!project) return { services: 0, portforwards: 0, terminals: 0 };
    return {
      services: snapshot.services.filter(
        (service) =>
          service.project === project &&
          (service.status === "running" || service.status === "starting"),
      ).length,
      portforwards: snapshot.portforwards.filter(
        (forward) =>
          forward.project === project &&
          (forward.status === "active" ||
            forward.status === "starting" ||
            forward.status === "restarting"),
      ).length,
      terminals: snapshot.terminals.filter((terminal) => terminal.project === project).length,
    };
  }, [project, snapshot.portforwards, snapshot.services, snapshot.terminals]);

  const confirm = async () => {
    if (!project) return;
    const ui = useUi.getState();
    const wasOnScreen = ui.view === "project" && ui.selectedProjectId === project;
    const next = snapshot.projects.find((item) => item.name !== project)?.name;
    await daemon.removeProject(project, true);
    disposeTerminalWorkspace(project);
    ui.clearProjectState(project);
    close();
    if (!wasOnScreen) return;
    // Nothing left to be the subject of the project view: leave it entirely.
    if (next) useUi.getState().openProject(next);
    else useUi.getState().setView("start");
  };

  return (
    <RemoveProjectDialog
      project={project}
      liveCounts={liveCounts}
      onCancel={close}
      onConfirm={confirm}
    />
  );
}
