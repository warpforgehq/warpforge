import { memo, useMemo, type ComponentProps } from "react";

import { useTaskSessionUpdates } from "@/hooks/useTaskSessionUpdates";
import { sessionActivity } from "@/lib/sessionActivity";

import { ChatTranscript } from "../../components/ChatTranscript";
import type { CommandInfo } from "../../protocol";
import { useTaskFileEditCacheSync } from "./useTaskQueries";

const EMPTY_TASK_COMMANDS: CommandInfo[] = [];

type TaskConversationProps = Omit<
  ComponentProps<typeof ChatTranscript>,
  "activity" | "commands" | "imageSupported" | "updates"
>;

export const TaskConversation = memo(function TaskConversation(props: TaskConversationProps) {
  const updates = useTaskSessionUpdates(props.task.id);
  useTaskFileEditCacheSync(props.task.id, updates);
  const activity = useMemo(() => sessionActivity(props.task, updates), [props.task, updates]);
  const commands = useMemo<CommandInfo[]>(() => {
    for (let index = updates.length - 1; index >= 0; index -= 1) {
      const update = updates[index];
      if (update.kind === "available_commands") {
        return update.commands;
      }
    }
    return EMPTY_TASK_COMMANDS;
  }, [updates]);
  const imageSupported = useMemo(() => {
    for (let index = updates.length - 1; index >= 0; index -= 1) {
      const update = updates[index];
      if (update.kind === "prompt_capabilities") {
        return update.image;
      }
    }
    return false;
  }, [updates]);

  return (
    <ChatTranscript
      key={props.task.id}
      {...props}
      activity={activity}
      commands={commands}
      imageSupported={imageSupported}
      updates={updates}
    />
  );
});
