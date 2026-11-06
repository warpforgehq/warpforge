import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { daemon } from "@/daemon";
import { DaemonRpcError } from "@/daemon/rpcError";
import { useTaskKeepers } from "@/hooks/useTaskKeepers";
import { keepersEligible, latestDraft, readyKeepers } from "@/lib/keepers";
import type { KeeperEntry, TaskInfo } from "@/protocol";

const PR_READY = "pr-ready";

function isPrReady(entry: KeeperEntry): boolean {
  return entry.id === PR_READY || entry.definition?.preset === PR_READY;
}

/**
 * The Create PR dialog's ready keepers. The first time `active` is true it
 * runs them on HEAD once; PR-ready's draft of that HEAD goes to `onDraft`,
 * unless the owner already wrote a description.
 * @param task The task the pull request is for.
 * @param active Whether the dialog shows its pull request form.
 * @param bodyEdited Whether the owner typed or generated the description.
 * @param body The description now.
 * @param onDraft Replaces the description with PR-ready's draft.
 * @returns The ready keepers with the task's state, and why the check did not start.
 */
export function usePrKeepers({
  task,
  active,
  bodyEdited,
  body,
  onDraft,
}: {
  task: TaskInfo | null;
  active: boolean;
  bodyEdited: boolean;
  body: string;
  onDraft: (text: string) => void;
}) {
  const eligible = Boolean(task && keepersEligible(task));
  const state = useTaskKeepers(task?.id ?? null);
  const list = useQuery({
    enabled: eligible,
    queryFn: () => daemon.listKeepers(task?.project ?? ""),
    queryKey: ["keepers", task?.project],
  });
  const ready = readyKeepers(list.data ?? [], state);
  const [error, setError] = useState<string | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const asked = useRef(false);
  const fetched = useRef(false);
  const filled = useRef<string | null>(null);

  useEffect(() => {
    if (!eligible || !task || state !== undefined || fetched.current) return;
    fetched.current = true;
    void daemon.refreshTaskKeepers(task.id).catch(() => {});
  }, [eligible, state, task]);

  const due = active && eligible && state !== undefined && ready.length > 0;
  useEffect(() => {
    if (!due || !task || asked.current) return;
    asked.current = true;
    daemon
      .checkReadyKeepers(task.id)
      .then((reply) => setHead(reply.head))
      .catch((cause: unknown) => {
        setError(cause instanceof DaemonRpcError ? cause.detail : String(cause));
      });
  }, [due, task]);

  const prReady = ready.find(({ entry }) => isPrReady(entry));
  const draft =
    head && prReady ? latestDraft(prReady.runs.filter((run) => run.headSha === head)) : null;
  const replaceable = !bodyEdited || body.trim() === "";
  useEffect(() => {
    if (!draft || filled.current === draft || !replaceable) return;
    filled.current = draft;
    onDraft(draft);
  }, [draft, replaceable, onDraft]);

  return { error, ready, state };
}
