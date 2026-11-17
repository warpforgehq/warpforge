import { ArrowRight, GitBranch, Loader2, Sparkles } from "lucide-react";

import type { GitPushInfo } from "../../protocol";

interface PrFormProps {
  info: GitPushInfo | null;
  needsPush: boolean;
  prTitle: string;
  setPrTitle: (v: string) => void;
  prBody: string;
  setPrBody: (v: string) => void;
  prBase: string;
  setPrBase: (v: string) => void;
  generatingPr: boolean;
  textGenAgentId: string | null;
  error: string | null;
  onGenerate: () => void;
}

export function PrForm({
  info,
  needsPush,
  prTitle,
  setPrTitle,
  prBody,
  setPrBody,
  prBase,
  setPrBase,
  generatingPr,
  textGenAgentId,
  error,
  onGenerate,
}: PrFormProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3">
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <GitBranch className="size-3.5 shrink-0 text-primary" />
        <span className="truncate font-mono text-foreground">{info?.branch}</span>
        <ArrowRight className="size-3.5 shrink-0" />
        <span className={prBase.trim() ? "truncate font-mono" : "truncate"}>
          {prBase.trim() || "default branch"}
        </span>
      </div>
      {needsPush && (
        <p className="-mt-1 text-[13px] text-muted-foreground">
          {info && info.commits.length > 0
            ? `${info.commits.length} ${info.commits.length === 1 ? "commit" : "commits"} will be pushed to ${info.upstream} first, then the PR is opened.`
            : "The branch will be pushed first, then the PR is opened."}
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">Title</span>
        <input
          value={prTitle}
          onChange={(e) => setPrTitle(e.target.value)}
          placeholder="Pull request title"
          className="h-8 rounded-md border bg-background px-2 py-1 font-sans text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-primary"
        />
      </label>
      <label className="flex min-h-0 flex-1 flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">Description</span>
        <div className="relative flex min-h-0 flex-1">
          <textarea
            value={prBody}
            onChange={(e) => setPrBody(e.target.value)}
            placeholder="Optional — Markdown supported"
            className="min-h-44 flex-1 resize-none rounded-md border bg-background py-1.5 pl-2 pr-9 font-sans text-[13px] leading-5 outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-primary"
          />
          <button
            type="button"
            className="absolute bottom-1.5 right-1.5 rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            disabled={generatingPr || !textGenAgentId}
            aria-label="Draft pull request title and description"
            title={
              textGenAgentId
                ? "Draft the title and description from the branch's commits"
                : "Pick a text-generation agent in Settings first"
            }
            onClick={onGenerate}
          >
            {generatingPr ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
          </button>
        </div>
      </label>
      {error && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-[13px] text-destructive"
        >
          {error}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">
          Base branch <span className="text-muted-foreground/60">(optional)</span>
        </span>
        <input
          value={prBase}
          onChange={(e) => setPrBase(e.target.value)}
          placeholder="repo default"
          className="h-8 rounded-md border bg-background px-2 py-1 font-sans text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground focus:border-primary"
        />
      </label>
    </div>
  );
}
