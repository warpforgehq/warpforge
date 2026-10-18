import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import { daemon } from "@/daemon";
import { enqueueSummary, isFactoryTask } from "@/lib/factory";
import type {
  DaemonEvent,
  EnqueueResult,
  FactoryConfig,
  RunnerEntry,
  RunnerStatus,
  TaskInfo,
} from "@/protocol";
import { useUi } from "@/store/ui";

export const runnerStatusKey = (project: string) => ["runner", project, "status"] as const;

/**
 * Keep every cached Factory status current off `runner.updated`. Mounted
 * once by the app shell, above its query provider, so views only read the cache.
 * @param queryClient The app's query client.
 */
export function useRunnerEvents(queryClient: QueryClient) {
  useEffect(
    () =>
      daemon.subscribeEvents((event: DaemonEvent) => {
        if (event.event !== "runner.updated") return;
        queryClient.setQueryData<RunnerStatus>(
          runnerStatusKey(event.data.settings.project),
          event.data,
        );
      }),
    [queryClient],
  );
}

/**
 * One project's Factory: its settings and every task it schedules.
 * @param project The project name; empty fetches nothing.
 * @returns The status query.
 */
export function useRunnerStatus(project: string) {
  return useQuery({
    enabled: project.length > 0,
    queryFn: () => daemon.runnerStatus(project),
    queryKey: runnerStatusKey(project),
    staleTime: 30_000,
  });
}

/**
 * The Factory entry of a task, while the Factory schedules it, and what
 * holds the project's queue.
 * @param task The task; non-Factory tasks fetch nothing.
 * @returns The entry, when there is one, and the project's status.
 */
export function useFactoryEntry(task: Pick<TaskInfo, "id" | "project" | "tags">): {
  entry: RunnerEntry | null;
  status: RunnerStatus | null;
} {
  const factory = isFactoryTask(task);
  const status = useRunnerStatus(factory ? task.project : "").data ?? null;
  const entry = status?.entries.find((candidate) => candidate.taskId === task.id) ?? null;
  return { entry, status };
}

/**
 * Tell the person what a start request did: started, queued, skipped.
 * @param result The daemon's answer.
 */
export function toastEnqueueResult(result: EnqueueResult) {
  const summary = enqueueSummary(result);
  if (result.created.length === 0) {
    toast(summary);
    return;
  }
  const wait = result.status.hold;
  toast.success(summary, {
    description: result.created.every((task) => task.started)
      ? "Follow them in the sidebar."
      : wait
        ? "Queued tasks start on their own when a slot frees."
        : "Queued tasks start on their own as soon as they can.",
  });
}

/**
 * Start Factory tasks for backlog items with one shared configuration.
 * @param project The project the items belong to.
 * @returns A function that starts them and resolves to the daemon's answer,
 *   or null when the request failed.
 */
export function useStartInFactory(project: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (itemIds: string[], config: FactoryConfig): Promise<EnqueueResult | null> => {
      try {
        const result = await daemon.runnerEnqueue(project, itemIds, config);
        queryClient.setQueryData(runnerStatusKey(project), result.status);
        await queryClient.invalidateQueries({ queryKey: ["backlog", project] });
        toastEnqueueResult(result);
        return result;
      } catch (error) {
        toast.error("Could not start in Factory", {
          description: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [project, queryClient],
  );
}

/**
 * Start a new Factory task configured like `task`, and open it.
 * @param task A failed, stopped or finished Factory task.
 */
export async function runAgain(task: Pick<TaskInfo, "id" | "project">) {
  try {
    const result = await daemon.runnerRetry(task.project, task.id);
    toastEnqueueResult(result);
    const created = result.created[0];
    if (created) useUi.getState().revealTask(created.taskId);
  } catch (error) {
    toast.error("Could not run it again", {
      description: error instanceof Error ? error.message : String(error),
    });
  }
}
