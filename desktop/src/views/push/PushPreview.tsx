import { ArrowRight, FileCode2, FolderTree, GitBranch, GitCommitHorizontal } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

import type { GitPushCommit, GitPushInfo } from "../../protocol";
import { PushPreviewSkeleton } from "./PushPreviewSkeleton";

const statusTone: Record<string, string> = {
  A: "text-ok",
  C: "text-warn",
  D: "text-destructive",
  M: "text-primary",
  R: "text-warn",
};

interface PushPreviewProps {
  info: GitPushInfo | null;
  loading: boolean;
  error: string | null;
  selected: GitPushCommit | null;
  selectedHash: string | null;
  onSelect: (hash: string) => void;
}

/**
 * The push dialog's body: outgoing commits on the left, the selected
 * commit's files on the right.
 * @param props The push preview, its load state and the selected commit.
 * @returns The two panes.
 */
export function PushPreview({
  info,
  loading,
  error,
  selected,
  selectedHash,
  onSelect,
}: PushPreviewProps) {
  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 basis-[46%] flex-col border-r">
        {info && (
          <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-primary/10 px-4 font-mono text-sm">
            <GitBranch className="size-4 shrink-0 text-primary" />
            <span className="truncate text-foreground">{info.branch}</span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-primary">{info.upstream}</span>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading && !info && <PushPreviewSkeleton />}
          {error && (
            <div className="m-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {info && info.commits.length === 0 && (
            <EmptyState
              icon={GitCommitHorizontal}
              title="Nothing to push"
              hint={`${info.branch} is up to date with ${info.upstream}.`}
            />
          )}
          {info?.commits.map((commit) => (
            <CommitRow
              key={commit.hash}
              commit={commit}
              selected={commit.hash === selectedHash}
              onSelect={() => onSelect(commit.hash)}
            />
          ))}
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b px-4 text-sm text-muted-foreground">
          <FolderTree className="size-4" />
          <span className="font-medium text-foreground">Files</span>
          {selected && (
            <span>
              {selected.files.length} {selected.files.length === 1 ? "file" : "files"}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {selected ? (
            <div className="space-y-0.5">
              {selected.files.map((file) => (
                <div
                  key={`${file.status}-${file.path}`}
                  className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-secondary/60"
                >
                  <FileCode2 className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
                  <span
                    className={cn(
                      "w-5 text-center font-mono text-xs font-semibold",
                      statusTone[file.status] ?? "text-muted-foreground",
                    )}
                  >
                    {file.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            !loading && (
              <EmptyState
                icon={FileCode2}
                title="Select a commit"
                hint="Its changed files will appear here."
              />
            )
          )}
        </div>
      </section>
    </div>
  );
}

function CommitRow({
  commit,
  selected,
  onSelect,
}: {
  commit: GitPushCommit;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-3 py-2 text-left transition-colors",
        selected ? "bg-primary/15 text-foreground" : "hover:bg-secondary/60",
      )}
    >
      <GitCommitHorizontal
        className={cn(
          "mt-0.5 size-4 shrink-0",
          selected ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{commit.subject}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[13px] text-muted-foreground">
          <span className="font-mono">{commit.shortHash}</span>
          <span className="truncate">{commit.author}</span>
          <span className="ml-auto shrink-0">
            {commit.files.length} {commit.files.length === 1 ? "file" : "files"}
          </span>
        </span>
      </span>
    </button>
  );
}
