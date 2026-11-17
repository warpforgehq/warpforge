import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, CloudCheck, GitCommitHorizontal, RefreshCw } from "lucide-react";

import { relativeTime } from "@/components/backlog/BacklogRow";
import { daemon } from "@/daemon";
import { cn } from "@/lib/utils";
import type { GitBranchCommit } from "@/protocol";

import { PushFooter } from "./PushFooter";
import type { useBranchActions } from "./useBranchActions";

export function CommitsPanel({
  taskId,
  selected,
  onSelect,
  actions,
  onCreatePr,
  createPrDisabledReason,
}: {
  taskId: string;
  selected: string | null;
  onSelect: (commit: GitBranchCommit) => void;
  actions: ReturnType<typeof useBranchActions>;
  onCreatePr: () => void;
  createPrDisabledReason?: string;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["branchCommits", taskId],
    queryFn: () => daemon.branchCommits(taskId),
    refetchOnWindowFocus: "always",
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <GitCommitHorizontal aria-hidden className="size-3.5" />
        <span className="min-w-0 flex-1 truncate">{actions.info?.branch ?? "Branch commits"}</span>
        <button
          type="button"
          aria-label="Refresh commits"
          title="Refresh commits"
          className="rounded p-1 hover:bg-secondary hover:text-foreground disabled:opacity-50"
          disabled={actions.loading || query.isFetching}
          onClick={() => {
            void actions.load();
            void queryClient.invalidateQueries({ queryKey: ["branchCommits", taskId] });
          }}
        >
          <RefreshCw
            aria-hidden
            className={cn("size-3.5", (actions.loading || query.isFetching) && "animate-spin")}
          />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {query.isPending && <p className="p-3">Loading commits…</p>}
        {query.error && (
          <p
            role="alert"
            className="m-1 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {query.error.message}
          </p>
        )}
        {query.data?.length === 0 && <p className="p-3">No commits relative to base.</p>}
        {query.data?.map((commit) => (
          <button
            type="button"
            key={commit.hash}
            aria-pressed={selected === commit.hash}
            onClick={() => onSelect(commit)}
            className={cn(
              "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors",
              selected === commit.hash ? "bg-primary/15 text-foreground" : "hover:bg-secondary/60",
              !commit.pushed && selected !== commit.hash && "bg-primary/5",
            )}
          >
            {commit.pushed ? (
              <CloudCheck
                aria-label="Pushed"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
            ) : (
              <ArrowUp aria-label="Unpushed" className="mt-0.5 size-4 shrink-0 text-primary" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{commit.subject}</span>
              <span className="mt-0.5 flex items-center gap-2 text-[13px] text-muted-foreground">
                <span className="font-mono">{commit.shortHash}</span>
                <span className="truncate">{commit.author}</span>
                <time className="ml-auto shrink-0" dateTime={commit.date} title={commit.date}>
                  {Number.isFinite(Date.parse(commit.date))
                    ? relativeTime(Date.parse(commit.date))
                    : ""}
                </time>
              </span>
            </span>
          </button>
        ))}
      </div>
      {actions.error && (
        <p
          role="alert"
          className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {actions.error}
        </p>
      )}
      <PushFooter
        info={actions.info}
        loading={actions.loading}
        pushing={actions.pushing}
        menuOpen={actions.menuOpen}
        onMenuOpenChange={actions.setMenuOpen}
        repositoryOperation={actions.repositoryOperation}
        createPrDisabledReason={createPrDisabledReason}
        onCreatePr={onCreatePr}
        onPush={(force) => void actions.push(force)}
      />
    </div>
  );
}
