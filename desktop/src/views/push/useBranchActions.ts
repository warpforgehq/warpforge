import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { daemon } from "@/daemon";
import { openExternalLink } from "@/lib/externalLinks";
import type { GitOpResult, GitPushInfo, TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";

import { usePrKeepers } from "./usePrKeepers";

export const branchCommitsKey = (taskId: string) => ["branchCommits", taskId] as const;

const pushNeeded = (info: GitPushInfo | null) =>
  Boolean(info && (!info.hasUpstream || info.commits.length > 0));

export function useBranchActions(task: TaskInfo | null) {
  const queryClient = useQueryClient();
  const [info, setInfo] = useState<GitPushInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState<"push" | "force" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [mode, setMode] = useState<"push" | "pr">("push");
  const [prTitle, setPrTitle] = useState("");
  const [prBody, setPrBody] = useState("");
  const [prBodyEdited, setPrBodyEdited] = useState(false);
  const [prBase, setPrBase] = useState("");
  const [creatingPr, setCreatingPr] = useState(false);
  const [prStep, setPrStep] = useState<"pushing" | "creating" | null>(null);
  const [generatingPr, setGeneratingPr] = useState(false);
  const textGenAgentId = useUi((state) => state.textGenAgentId);
  const textGenModel = useUi((state) => state.textGenModel);
  const repositoryOperation = useUi((state) => state.repositoryOperation);
  const setRepositoryOperation = useUi((state) => state.setRepositoryOperation);

  const prKeepers = usePrKeepers({
    active: mode === "pr",
    body: prBody,
    bodyEdited: prBodyEdited,
    onDraft: setPrBody,
    task,
  });

  const taskId = task?.id;
  const load = useCallback(async () => {
    if (!taskId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = (await daemon.request("git.pushInfo", {
        task_id: taskId,
      })) as GitPushInfo;
      setInfo(next);
      setPrTitle((current) =>
        current
          ? current
          : next.commits.length === 1
            ? (next.commits[0]?.subject ?? next.branch)
            : next.branch,
      );
    } catch (reason) {
      setInfo(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    setInfo(null);
    setError(null);
    setMode("push");
    setPrTitle("");
    setPrBody("");
    setPrBodyEdited(false);
    setPrBase("");
    void load();
  }, [load]);

  const push = async (force: boolean) => {
    if (!task || pushing || repositoryOperation) {
      return;
    }
    setMenuOpen(false);
    setPushing(force ? "force" : "push");
    setRepositoryOperation({ kind: "push", taskId: task.id });
    try {
      const result = (await daemon.request("git.push", {
        force,
        task_id: task.id,
      })) as GitOpResult;
      if (result.status === "ok" || result.status === "up_to_date") {
        (result.status === "ok" ? toast.success : toast.info)(result.message);
        void queryClient.invalidateQueries({ queryKey: branchCommitsKey(task.id) });
        void load();
      } else {
        toast.error(result.message);
      }
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPushing(null);
      const operation = useUi.getState().repositoryOperation;
      if (operation?.taskId === task.id && operation.kind === "push") {
        setRepositoryOperation(null);
      }
    }
  };

  const needsPush = pushNeeded(info);

  const generatePr = async () => {
    if (!task || !textGenAgentId || generatingPr) {
      return;
    }
    setGeneratingPr(true);
    setGenerateError(null);
    try {
      const text = await daemon.generateText(
        task.id,
        textGenAgentId,
        "pr_description",
        textGenModel ?? undefined,
      );
      const [first = "", ...rest] = text.split("\n");
      setPrTitle(first.replace(/^#+\s*/, "").trim());
      setPrBody(rest.join("\n").trim());
      setPrBodyEdited(true);
    } catch (reason) {
      setGenerateError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGeneratingPr(false);
    }
  };

  const createPr = async () => {
    if (!task || creatingPr || repositoryOperation || !info || !prTitle.trim()) {
      return;
    }
    setCreatingPr(true);
    setRepositoryOperation({ kind: "push", taskId: task.id });
    try {
      const latest = (await daemon.request("git.pushInfo", { task_id: task.id })) as GitPushInfo;
      if (pushNeeded(latest)) {
        setPrStep("pushing");
        const pushed = (await daemon.request("git.push", {
          force: false,
          task_id: task.id,
        })) as GitOpResult;
        if (pushed.status !== "ok" && pushed.status !== "up_to_date") {
          toast.error(pushed.message);
          return;
        }
      }
      void queryClient.invalidateQueries({ queryKey: branchCommitsKey(task.id) });
      setPrStep("creating");
      const result = (await daemon.request("git.createPr", {
        base: prBase.trim() || undefined,
        body: prBody,
        task_id: task.id,
        title: prTitle.trim(),
      })) as { url: string };
      setMode("push");
      setPrTitle("");
      setPrBody("");
      setPrBodyEdited(false);
      setPrBase("");
      setGenerateError(null);
      if (result.url) {
        toast.success("Pull request created", {
          action: { label: "Open", onClick: () => void openExternalLink(result.url) },
          description: result.url,
        });
        void openExternalLink(result.url);
      } else {
        toast.success("Pull request created");
      }
      void queryClient.invalidateQueries({ queryKey: branchCommitsKey(task.id) });
      void load();
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCreatingPr(false);
      setPrStep(null);
      const operation = useUi.getState().repositoryOperation;
      if (operation?.taskId === task.id && operation.kind === "push") {
        setRepositoryOperation(null);
      }
    }
  };

  return {
    info,
    loading,
    pushing,
    menuOpen,
    setMenuOpen,
    error,
    generateError,
    mode,
    setMode,
    prTitle,
    setPrTitle,
    prBody,
    setPrBody,
    setPrBodyEdited,
    prBase,
    setPrBase,
    creatingPr,
    prStep,
    generatingPr,
    textGenAgentId,
    repositoryOperation,
    prKeepers,
    needsPush,
    generatePr,
    createPr,
    push,
    load,
  };
}
