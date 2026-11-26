import { forwardRef, memo, useCallback, useRef } from "react";

import { daemon } from "../daemon";
import { useDictation } from "../hooks/useDictation";
import { useDictationShortcut } from "../hooks/useDictationShortcut";
import { useWorkflowSend } from "../hooks/useWorkflowSend";
import type { ContextUsage } from "../lib/sessionUsage";
import type { CommandInfo, ProjectFile, PromptSubmission, TaskInfo } from "../protocol";
import { AgentConfigBar } from "./AgentConfigBar";
import type { ComposerHandle } from "./Composer";
import { Composer } from "./Composer";
import { DictationButton } from "./composer/DictationButton";

interface Props {
  commands: CommandInfo[];
  files: ProjectFile[];
  filesLoading: boolean;
  imageSupported: boolean;
  contextUsage?: ContextUsage;
  onBeforeSend: () => void;
  task: TaskInfo;
}

export const ChatComposer = memo(
  forwardRef<ComposerHandle, Props>(function ChatComposer(
    { commands, contextUsage, files, filesLoading, imageSupported, onBeforeSend, task },
    ref,
  ) {
    const workflow = useWorkflowSend(task);
    const composerRef = useRef<ComposerHandle | null>(null);
    const setComposerRef = useCallback(
      (handle: ComposerHandle | null) => {
        composerRef.current = handle;
        if (typeof ref === "function") ref(handle);
        else if (ref) ref.current = handle;
      },
      [ref],
    );
    const disabled = task.status === "done" || workflow.disabled;
    const dictation = useDictation(
      useCallback((text: string) => composerRef.current?.insertText(text), []),
    );
    useDictationShortcut(dictation, !disabled);

    const onSend = useCallback(
      async (submission: PromptSubmission) => {
        onBeforeSend();
        if (await workflow.send(submission)) return;
        await daemon.request("session.prompt", { task_id: task.id, ...submission });
      },
      [onBeforeSend, task.id, workflow],
    );

    // For a workflow parent the daemon maps task.cancel onto stopping the
    // whole pipeline, so the composer's stop button stays the terminal
    // "kill it" affordance next to WorkflowControls' soft pause.
    const onCancel = useCallback(async () => {
      await daemon.request("task.cancel", { task_id: task.id });
    }, [task.id]);

    const isRunning = task.status === "running" || task.status === "queued";

    return (
      <Composer
        ref={setComposerRef}
        commands={commands}
        contextUsage={contextUsage}
        files={files}
        filesLoading={filesLoading}
        imageSupported={imageSupported}
        disabled={disabled}
        onSend={onSend}
        onCancel={isRunning && !workflow.isWorkflow ? onCancel : undefined}
        placeholder={workflow.placeholder}
        toolbar={
          <>
            {task.configOptions && task.configOptions.length > 0 && (
              <AgentConfigBar taskId={task.id} options={task.configOptions} />
            )}
            <DictationButton dictation={dictation} disabled={disabled} />
          </>
        }
      />
    );
  }),
);
