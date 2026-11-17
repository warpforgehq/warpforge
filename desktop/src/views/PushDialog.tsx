import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { openExternalLink } from "@/lib/externalLinks";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

import { daemon } from "../daemon";
import type { GitOpResult, GitPushInfo, TaskInfo } from "../protocol";
import { KeeperWarning } from "./push/KeeperWarning";
import { PrFooter } from "./push/PrFooter";
import { PrForm } from "./push/PrForm";
import { PushFooter } from "./push/PushFooter";
import { PushPreview } from "./push/PushPreview";
import { ReadyKeepers } from "./push/ReadyKeepers";
import { usePrKeepers } from "./push/usePrKeepers";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskInfo | null;
}

export default function PushDialog({ open, onOpenChange, task }: Props) {
  const [info, setInfo] = useState<GitPushInfo | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState<"push" | "force" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      setSelectedHash((current) =>
        next.commits.some((commit) => commit.hash === current)
          ? current
          : (next.commits[0]?.hash ?? null),
      );
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
    void load();
  }, [load]);

  const selected = useMemo(
    () => info?.commits.find((commit) => commit.hash === selectedHash) ?? null,
    [info, selectedHash],
  );

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
      if (result.status === "ok") {
        toast.success(result.message);
        onOpenChange(false);
      } else if (result.status === "up_to_date") {
        toast.info(result.message);
        onOpenChange(false);
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

  const needsPush = Boolean(info) && (!info?.hasUpstream || (info?.commits.length ?? 0) > 0);

  const generatePr = async () => {
    if (!task || !textGenAgentId || generatingPr) {
      return;
    }
    setGeneratingPr(true);
    setError(null);
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
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGeneratingPr(false);
    }
  };

  const createPr = async () => {
    if (!task || creatingPr || !prTitle.trim()) {
      return;
    }
    setCreatingPr(true);
    if (needsPush) {
      setRepositoryOperation({ kind: "push", taskId: task.id });
    }
    try {
      if (needsPush) {
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
      setPrStep("creating");
      const result = (await daemon.request("git.createPr", {
        base: prBase.trim() || undefined,
        body: prBody,
        task_id: task.id,
        title: prTitle.trim(),
      })) as { url: string };
      if (result.url) {
        toast.success("Pull request created", {
          action: { label: "Open", onClick: () => void openExternalLink(result.url) },
          description: result.url,
        });
        void openExternalLink(result.url);
      } else {
        toast.success("Pull request created");
      }
      onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={(next) => !pushing && !creatingPr && onOpenChange(next)}>
      <DialogContent className="flex h-[72vh] max-h-[760px] w-[min(1050px,92vw)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <div className="flex h-14 shrink-0 items-center border-b px-5">
          <div className="min-w-0">
            <DialogTitle className="truncate text-base">
              Push commits to {task?.project ?? "project"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Review outgoing commits and their files before pushing the current branch.
            </DialogDescription>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="ml-auto mr-8 size-8"
            disabled={loading || Boolean(pushing)}
            onClick={() => void load()}
            title="Refresh push preview"
          >
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>

        {mode === "pr" && (
          <PrForm
            info={info}
            needsPush={needsPush}
            prTitle={prTitle}
            setPrTitle={setPrTitle}
            prBody={prBody}
            setPrBody={(body) => {
              setPrBody(body);
              setPrBodyEdited(true);
            }}
            prBase={prBase}
            setPrBase={setPrBase}
            generatingPr={generatingPr}
            textGenAgentId={textGenAgentId}
            error={error}
            onGenerate={() => void generatePr()}
          />
        )}

        {mode === "push" && (
          <PushPreview
            info={info}
            loading={loading}
            error={error}
            selected={selected}
            selectedHash={selectedHash}
            onSelect={setSelectedHash}
          />
        )}

        {mode === "pr" && <ReadyKeepers {...prKeepers} />}
        <KeeperWarning taskId={task?.id ?? null} />
        {mode === "pr" ? (
          <PrFooter
            creatingPr={creatingPr}
            prTitle={prTitle}
            prStep={prStep}
            needsPush={needsPush}
            repositoryOperation={repositoryOperation}
            onBack={() => setMode("push")}
            onCancel={() => onOpenChange(false)}
            onCreatePr={() => void createPr()}
          />
        ) : (
          <PushFooter
            info={info}
            loading={loading}
            pushing={pushing}
            menuOpen={menuOpen}
            onMenuOpenChange={setMenuOpen}
            repositoryOperation={repositoryOperation}
            onCancel={() => onOpenChange(false)}
            onCreatePr={() => setMode("pr")}
            onPush={(force) => void push(force)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
