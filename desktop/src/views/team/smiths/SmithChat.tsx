import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";

import type { ComposerHandle } from "@/components/Composer";
import type { ProjectFile, Smith, Snapshot } from "@/protocol";
import { daemonQuery } from "@/query";
import { useUi } from "@/store/ui";

import { TaskConversation } from "../../task-detail/TaskConversation";

interface Props {
  smith: Smith;
  snapshot: Snapshot;
  onOpenTask: (id: string) => void;
}

/** File links in the chat are not resolved here; the task view does that. */
const noFileLinks = () => null;

/**
 * The conversation with a teammate: its thread task's own chat, both sides,
 * streaming, with the composer — the same transcript the task view shows.
 */
export function SmithChat({ smith, snapshot, onOpenTask }: Props) {
  const composerRef = useRef<ComposerHandle>(null);
  const openTaskWithNav = useUi((state) => state.openTaskWithNav);
  const task = snapshot.tasks.find((candidate) => candidate.id === smith.threadTaskId);
  const files = useQuery({
    enabled: !!task,
    queryFn: daemonQuery<ProjectFile[]>("file.list", { project: smith.homeProject }),
    queryKey: ["fileList", "smith", smith.homeProject],
  });

  if (!task) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-md border border-border text-[13px] text-muted-foreground">
        {smith.name}'s conversation is not available yet.
      </div>
    );
  }
  return (
    <section
      aria-label={`Conversation with ${smith.name}`}
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border"
    >
      <TaskConversation
        active
        agents={(snapshot.agents ?? []).filter((agent) => agent.enabled)}
        files={Array.isArray(files.data) ? files.data : []}
        filesLoading={files.isLoading}
        composerRef={composerRef}
        onOpenFile={(path) => openTaskWithNav(task.id, { path, surface: "files" })}
        onOpenFileDiff={(path, hunks) => openTaskWithNav(task.id, { hunks, path, surface: "diff" })}
        onOpenTask={onOpenTask}
        resolveFilePath={noFileLinks}
        task={task}
      />
    </section>
  );
}
