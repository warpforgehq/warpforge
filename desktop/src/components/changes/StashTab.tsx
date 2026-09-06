import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, Loader2, PackageOpen, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { daemon } from "../../daemon";
import type { FileDiff, StashList } from "../../protocol";
import { daemonQuery } from "../../query";
import { BundleConfirmDialog, type BundleConfirmRequest } from "./BundleConfirmDialog";
import { IgnoredFiles } from "./IgnoredFiles";
import { reportGitFailure } from "./reportGitFailure";

/**
 * The Stash tab: git-native stash entries, newest first. Pick an entry to
 * see its files and a read-only diff preview, then apply or pop the whole
 * entry, restore a single file out of it, or drop it.
 *
 * Unlike the shelf, the stash is shared across every worktree of the repo —
 * the note below the list says so, because entries made elsewhere show up
 * here too.
 */
export function StashTab({
  taskId,
  onRefresh,
}: {
  taskId: string;
  /** Refetch the Commit tab: applying touches the working tree. */
  onRefresh: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ action: "apply-drop" | "drop"; id: string } | null>(
    null,
  );

  const listQuery = useQuery({
    queryFn: daemonQuery<StashList>("stash.list", { task_id: taskId }),
    queryKey: ["stashList", taskId],
  });
  const entries = useMemo(() => listQuery.data?.entries ?? [], [listQuery.data]);
  // Same contract as the Shelf tab: auto-first only until the user picks;
  // a vanished pick selects nothing rather than substituting silently.
  const selected =
    selectedId !== null
      ? (entries.find((e) => e.id === selectedId) ?? null)
      : (entries[0] ?? null);

  const detailQuery = useQuery({
    enabled: selected !== null,
    queryFn: () =>
      daemon.request("stash.get", { id: selected!.id, task_id: taskId }) as Promise<{
        entry: (typeof entries)[number];
        files: FileDiff[];
      }>,
    queryKey: ["stashGet", taskId, selected?.id ?? ""],
  });
  const detailFiles = useMemo(() => detailQuery.data?.files ?? [], [detailQuery.data]);
  const preview = detailFiles.find((f) => f.path === previewPath) ?? detailFiles[0] ?? null;

  const refreshAll = async () => {
    await listQuery.refetch();
    await detailQuery.refetch();
    onRefresh();
  };

  const apply = async (pop: boolean) => {
    if (!selected || busy) {
      return;
    }
    setBusy(true);
    try {
      await daemon.request("stash.apply", {
        id: selected.id,
        pop,
        task_id: taskId,
      });
      if (pop) {
        setSelectedId(null);
      }
      setPreviewPath(null);
      setConfirm(null);
      await refreshAll();
    } catch (e) {
      reportGitFailure(pop ? "Could not pop the stash entry" : "Could not apply the stash entry", e);
    } finally {
      setBusy(false);
    }
  };

  const restoreFile = async (path: string) => {
    if (!selected || busy) {
      return;
    }
    setBusy(true);
    try {
      await daemon.request("stash.file", {
        id: selected.id,
        paths: [path],
        task_id: taskId,
      });
      onRefresh();
    } catch (e) {
      reportGitFailure("Could not restore the file from the stash", e);
    } finally {
      setBusy(false);
    }
  };

  const dropEntry = async () => {
    if (!selected || busy) {
      return;
    }
    setBusy(true);
    try {
      await daemon.request("stash.drop", { id: selected.id, task_id: taskId });
      setSelectedId(null);
      setPreviewPath(null);
      setConfirm(null);
      await listQuery.refetch();
    } catch (e) {
      reportGitFailure("Could not drop the stash entry", e);
    } finally {
      setBusy(false);
    }
  };

  const confirmRequest: BundleConfirmRequest | null =
    confirm && selected && confirm.id === selected.id
      ? confirm.action === "apply-drop"
        ? {
            confirmLabel: "Apply & Drop",
            description: `${selected.files.length} file${selected.files.length === 1 ? "" : "s"} will be restored into the working tree, then ${selected.id} will be dropped from the stash.`,
            files: selected.files,
            title: `Apply & Drop ${selected.id}`,
          }
        : {
            confirmLabel: "Drop entry",
            description:
              "The entry will be dropped from the stash. The working tree is untouched — stashed files will not come back.",
            files: selected.files,
            title: `Drop ${selected.id}`,
          }
      : null;

  const confirmAction = () => {
    if (confirm?.action === "apply-drop") {
      void apply(true);
    } else if (confirm?.action === "drop") {
      void dropEntry();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-9 items-center gap-1 border-b border-rule px-3 text-sm font-semibold">
        <button
          type="button"
          aria-label={selected ? `Apply ${selected.id}` : "Apply stash entry"}
          title="Apply the entry, keeping it in the stash"
          disabled={busy || !selected}
          onClick={() => void apply(false)}
          className="flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-1 text-xs font-normal text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ArrowDownToLine className="size-3.5" />
          )}
          Apply
        </button>
          <button
          type="button"
          aria-label={selected ? `Apply and drop ${selected.id}` : "Apply and drop stash entry"}
          title="Apply the entry and drop it from the stash"
          disabled={busy || !selected}
          onClick={() => selected && setConfirm({ action: "apply-drop", id: selected.id })}
          className="flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-1 text-xs font-normal text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <PackageOpen className="size-3.5" />}
          Apply & Drop
        </button>
        <span className="min-w-0 flex-1" />
        <button
          type="button"
          aria-label="Refresh stash"
          title="Refresh stash"
          disabled={busy}
          onClick={() => void listQuery.refetch()}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={selected ? `Drop ${selected.id}` : "Drop stash entry"}
          title="Drop this stash entry (the worktree is untouched)"
          disabled={busy || !selected}
          onClick={() => selected && setConfirm({ action: "drop", id: selected.id })}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1.5">
        {listQuery.isPending ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Loading stash…</p>
        ) : listQuery.isError ? (
          <p className="px-3 py-2 text-xs text-warn">Stash unavailable.</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No stash entries. Stash from the terminal with `git stash push -m "name"`.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {entries.map((entry) => {
              const active = selected?.id === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  title={`${entry.id}: ${entry.message}`}
                  disabled={busy}
                  onClick={() => {
                    setSelectedId(entry.id);
                    setPreviewPath(null);
                  }}
                  className={cn(
                    "flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-secondary/50",
                    active && "bg-secondary",
                  )}
                >
                  <span
                    className={cn(
                      "truncate text-xs font-medium",
                      active ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {entry.message || "(no message)"}
                  </span>
                  <span className="tnum truncate text-[10px] text-muted-foreground/70">
                    <span className="mr-1.5 font-mono text-info">{entry.id}</span>
                    {entry.createdAt > 0
                      ? `${new Date(entry.createdAt * 1000).toLocaleString()} · `
                      : ""}
                    {entry.branch ? `${entry.branch} · ` : ""}
                    {entry.files.length} file{entry.files.length === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {selected && (
          <div className="mt-1.5 border-t border-rule pt-1.5">
            <IgnoredFiles
              state="list"
              files={selected.files}
              heading="Stashed Files"
              truncated={false}
              selected={preview?.path ?? null}
              onSelect={(path) => setPreviewPath(path)}
            />

            {detailQuery.isPending ? (
              <p className="px-3 py-1 text-xs text-muted-foreground">Loading preview…</p>
            ) : (
              preview && (
                <StashFilePreview
                  file={preview}
                  busy={busy}
                  onRestore={() => void restoreFile(preview.path)}
                />
              )
            )}
          </div>
        )}

        {entries.length > 0 && (
          <p className="px-3 py-2 text-[10px] text-muted-foreground/70">
            The stash is shared across every worktree of this repo.
          </p>
        )}
      </div>

      <BundleConfirmDialog
        request={confirmRequest}
        busy={busy}
        onClose={() => setConfirm(null)}
        onConfirm={confirmAction}
      />
    </div>
  );
}

/** Read-only unified preview of one stashed file, with per-file restore. */
function StashFilePreview({
  file,
  busy,
  onRestore,
}: {
  file: FileDiff;
  busy: boolean;
  onRestore: () => void;
}) {
  return (
    <div className="mt-1 border-t border-rule px-3 py-1.5">
      <div className="flex items-center gap-2 py-0.5">
        <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {file.path}
        </p>
        <button
          type="button"
          title="Restore this file into the working tree (the entry is kept)"
          disabled={busy}
          onClick={onRestore}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          Restore this file
        </button>
      </div>
      <div className="max-h-64 overflow-auto rounded bg-deep-surface p-1.5 font-mono text-[11px] leading-5">
        {file.hunks.length === 0 && (
          <p className="text-muted-foreground">No hunks — empty change.</p>
        )}
        {file.hunks.map((hunk, i) => (
          <div key={`${hunk.oldStart}-${hunk.newStart}-${i}`} className="mb-1 last:mb-0">
            <p className="text-muted-foreground/70">
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </p>
            {hunk.lines.map((line, j) => (
              <p
                key={`${j}-${line.slice(0, 32)}`}
                className={cn(
                  "whitespace-pre",
                  line.startsWith("+")
                    ? "text-ok"
                    : line.startsWith("-")
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
