import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, CloudCheck, GitCommitHorizontal, RefreshCw } from "lucide-react";

import { relativeTime } from "@/components/backlog/BacklogRow";
import { EmptyState } from "@/components/ui/empty-state";
import { daemon } from "@/daemon";
import { cn } from "@/lib/utils";
import type { GitBranchCommit } from "@/protocol";

import { PushFooter } from "./PushFooter";
import { PushPreviewSkeleton } from "./PushPreviewSkeleton";
import { branchCommitsKey } from "./useBranchActions";
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
    queryKey: branchCommitsKey(taskId),
    queryFn: () => daemon.branchCommits(taskId),
    refetchOnWindowFocus: "always",
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2 text-[11px] text-muted-foreground">
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
            void queryClient.invalidateQueries({ queryKey: branchCommitsKey(taskId) });
          }}
        >
          <RefreshCw
            aria-hidden
            className={cn("size-3.5", (actions.loading || query.isFetching) && "animate-spin")}
          />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {query.isPending && <PushPreviewSkeleton />}
        {query.error && <EmptyState compact role="alert" title={query.error.message} />}
        {query.data?.length === 0 && <EmptyState compact title="No commits relative to base." />}
        {query.data?.map((commit) => {
          const date = Date.parse(commit.date);
          return (
            <button
              type="button"
              key={commit.hash}
              aria-pressed={selected === commit.hash}
              onClick={() => onSelect(commit)}
              className={cn(
                "flex w-full items-start gap-2 px-2 py-1 text-left transition-colors",
                selected === commit.hash ? "bg-accent text-foreground" : "hover:bg-accent/50",
              )}
            >
              {commit.pushed ? (
                <CloudCheck
                  aria-label="Pushed"
                  className="mt-0.5 size-3 shrink-0 text-muted-foreground"
                />
              ) : (
                <ArrowUp aria-label="Unpushed" className="mt-0.5 size-3 shrink-0 text-primary" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{commit.subject}</span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="font-mono">{commit.shortHash}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{commit.author}</span>
                  <span aria-hidden>·</span>
                  <time className="shrink-0" dateTime={commit.date} title={commit.date}>
                    {Number.isFinite(date) ? relativeTime(date) : ""}
                  </time>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {actions.error && <EmptyState compact role="alert" title={actions.error} />}
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
