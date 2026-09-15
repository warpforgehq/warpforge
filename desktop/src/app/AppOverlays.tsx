import { lazy, useSyncExternalStore } from "react";
import { toast } from "sonner";

import AttentionToast from "@/components/AttentionToast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { daemon } from "@/daemon";
import { useTauriClose } from "@/hooks/useTauriClose";
import type { Snapshot, TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

import type { AppDialogs } from "./dialogs";
import {
  getPendingAgentSetup,
  AgentUpdatesHost,
  PrAssistantLifecycleHost,
  SettingsPrefetchHost,
} from "./hosts";
import { QuickOpenHost, type ProjectSubject } from "./QuickOpenHost";

const AddProjectDialog = lazy(() => import("../views/AddProjectDialog"));
const AgentSetupDialog = lazy(() => import("../views/AgentSetupDialog"));
const BootstrapWizard = lazy(() => import("@/components/BootstrapWizard"));
const PushDialog = lazy(() => import("../views/PushDialog"));
const SettingsView = lazy(() => import("../views/settings"));

export interface AppOverlaysProps {
  dialogs: AppDialogs;
  snapshot: Snapshot;
  openTask: TaskInfo | null;
  openTaskId: string | null;
  hasOpenTask: boolean;
  projects: string[];
  /** The project the content column is showing, when it is showing one. */
  projectSubject: ProjectSubject | null;
}

export function AppOverlays({
  dialogs,
  snapshot,
  openTask,
  openTaskId,
  hasOpenTask,
  projects,
  projectSubject,
}: AppOverlaysProps) {
  const pendingAgentSetup = useSyncExternalStore(daemon.subscribe, getPendingAgentSetup);
  const pendingQuit = useTauriClose();
  const {
    pushOpen,
    setPushOpen,
    addProjectOpen,
    setAddProjectOpen,
    wizardProject,
    setWizardProject,
    settingsOpen,
    setSettingsOpen,
  } = dialogs;

  return (
    <>
      {pushOpen && <PushDialog open onOpenChange={setPushOpen} task={openTask} />}
      <QuickOpenHost openTaskId={openTaskId} hasOpenTask={hasOpenTask} project={projectSubject} />
      <PrAssistantLifecycleHost projects={projects} />
      <AgentUpdatesHost />
      <SettingsPrefetchHost />
      {addProjectOpen && (
        <AddProjectDialog
          open
          onOpenChange={setAddProjectOpen}
          onAdded={dialogs.handleProjectAdded}
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
              {pendingQuit.more > 0 ? `, and ${pendingQuit.more} more` : ""}. Quitting stops them.
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
    </>
  );
}
