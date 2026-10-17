import { useCallback, useState } from "react";
import { toast } from "sonner";

import type { TaskMode } from "@/components/TaskComposeBar";
import { useUi } from "@/store/ui";
import type { FactorySeed } from "@/views/NewTaskDialog/useFactoryBatch";

/** How New Task opens beyond its prompt: its mode, or several backlog items. */
export interface NewTaskOptions {
  mode?: TaskMode;
  factory?: FactorySeed | null;
  /** Called with the new task's id once it is created. */
  onCreated?: (taskId: string) => void;
}

export interface AppDialogs {
  newTaskOpen: boolean;
  setNewTaskOpen: (open: boolean) => void;
  newTaskProject: string | null;
  newTaskPrompt: string | undefined;
  newTaskBacklogItemId: string | null;
  newTaskOptions: NewTaskOptions;
  pushOpen: boolean;
  setPushOpen: (open: boolean) => void;
  addProjectOpen: boolean;
  setAddProjectOpen: (open: boolean) => void;
  wizardProject: string | null;
  setWizardProject: (project: string | null) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** Open New Task, optionally pre-filling a project, prompt, backlog link and mode. */
  startNewTask: (
    project?: string,
    prompt?: string,
    backlogItemId?: string,
    options?: NewTaskOptions,
  ) => void;
  /** Select the freshly added project and offer its setup wizard. */
  handleProjectAdded: (name: string) => void;
}

/** Dialog open/closed state for the shell, so `App` stays a composition root. */
export function useAppDialogs(): AppDialogs {
  const openProject = useUi((s) => s.openProject);
  const [newTaskProject, setNewTaskProject] = useState<string | null>(null);
  const [newTaskPrompt, setNewTaskPrompt] = useState<string | undefined>(undefined);
  // Set when the new-task surface was opened from a backlog item, so the
  // created task can be linked back to it.
  const [newTaskBacklogItemId, setNewTaskBacklogItemId] = useState<string | null>(null);
  const [newTaskOptions, setNewTaskOptions] = useState<NewTaskOptions>({});
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [pushOpen, setPushOpen] = useState(false);
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const [wizardProject, setWizardProject] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const startNewTask = useCallback(
    (project?: string, prompt?: string, backlogItemId?: string, options?: NewTaskOptions) => {
      setNewTaskProject(project ?? null);
      setNewTaskPrompt(prompt);
      setNewTaskBacklogItemId(backlogItemId ?? null);
      setNewTaskOptions(options ?? {});
      setNewTaskOpen(true);
    },
    [],
  );

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

  return {
    newTaskOpen,
    setNewTaskOpen,
    newTaskProject,
    newTaskPrompt,
    newTaskBacklogItemId,
    newTaskOptions,
    pushOpen,
    setPushOpen,
    addProjectOpen,
    setAddProjectOpen,
    wizardProject,
    setWizardProject,
    settingsOpen,
    setSettingsOpen,
    startNewTask,
    handleProjectAdded,
  };
}
