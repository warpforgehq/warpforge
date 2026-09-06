import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, Loader2, PackageOpen, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "@/lib/utils";

import { daemon } from "../../daemon";
import type { FileDiff, ShelfList } from "../../protocol";
import { daemonQuery } from "../../query";
import { BundleConfirmDialog, type BundleConfirmRequest } from "./BundleConfirmDialog";
import { IgnoredFiles } from "./IgnoredFiles";
import { reportGitFailure } from "./reportGitFailure";

/**
 * The Shelf tab: named bundles of shelved uncommitted changes, newest first.
 * Pick a bundle to see its files and a read-only diff preview, then unshelve
 * it back into the worktree (dropping the bundle by default) or delete it.
 */
export function ShelfTab({
  taskId,
  onRefresh,
}: {
  taskId: string;
  /** Refetch the Commit tab: unshelving rewrites the working tree. */
  onRefresh: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ action: "apply-drop" | "drop"; id: string } | null>(
    null,
  );

  const listQuery = useQuery({
    queryFn: daemonQuery<ShelfList>("shelf.list", { task_id: taskId }),
    queryKey: ["shelfList", taskId],
  });
  const entries = useMemo(() => listQuery.data?.entries ?? [], [listQuery.data]);
  // Auto-select the newest only while the user never picked one (initial load,
  // or right after our own drop). If a *chosen* id vanishes from a refetch
  // (dropped elsewhere), select nothing — firing header actions against a
  // silently substituted entry is worse than asking to pick again.
  const selected =
    selectedId !== null
      ? (entries.find((e) => e.id === selectedId) ?? null)
      : (entries[0] ?? null);

  const detailQuery = useQuery({
    enabled: selected !== null,
    queryFn: () =>
      daemon.request("shelf.get", { id: selected!.id, task_id: taskId }) as Promise<{
        entry: (typeof entries)[number];
        files: FileDiff[];
      }>,
    queryKey: ["shelfGet", taskId, selected?.id ?? ""],
  });
  const detailFiles = useMemo(() => detailQuery.data?.files ?? [], [detailQuery.data]);
  const preview = detailFiles.find((f) => f.path === previewPath) ?? detailFiles[0] ?? null;

  const unshelve = async (drop: boolean) => {
    if (!selected || busy) {
      return;
    }
    setBusy(true);
    try {
      await daemon.request("shelf.apply", {
        drop,
        id: selected.id,
        task_id: taskId,
      });
      if (drop) {
        setSelectedId(null);
      }
      setPreviewPath(null);
      setConfirm(null);
      await listQuery.refetch();
      await detailQuery.refetch();
      onRefresh();
    } catch (e) {
      reportGitFailure("Could not unshelve", e);
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
      await daemon.request("shelf.drop", { id: selected.id, task_id: taskId });
      setSelectedId(null);
      setPreviewPath(null);
      setConfirm(null);
      await listQuery.refetch();
    } catch (e) {
      reportGitFailure("Could not delete the shelf entry", e);
    } finally {
      setBusy(false);
    }
  };

  const confirmRequest: BundleConfirmRequest | null =
    confirm && selected && confirm.id === selected.id
      ? confirm.action === "apply-drop"
        ? {
            confirmLabel: "Apply & Drop",
            description: `${selected.files.length} file${selected.files.length === 1 ? "" : "s"} will be restored into the working tree, then the entry will be deleted.`,
            files: selected.files,
            title: `Apply & Drop "${selected.name}"`,
          }
        : {
            confirmLabel: "Delete entry",
            description:
              "The entry will be deleted. The working tree is untouched — shelved files will not come back.",
            files: selected.files,
            title: `Delete "${selected.name}"`,
          }
      : null;

  const confirmAction = () => {
    if (confirm?.action === "apply-drop") {
      void unshelve(true);
    } else if (confirm?.action === "drop") {
      void dropEntry();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex h-9 items-center gap-1 border-b border-rule px-3 text-sm font-semibold">
        <button
          type="button"
          aria-label={selected ? `Apply ${selected.name}` : "Apply shelf entry"}
          title="Apply the entry, keeping it on the shelf"
          disabled={busy || !selected}
          onClick={() => void unshelve(false)}
          className="flex items-center gap-1.5 whitespace-nowrap rounded px-1.5 py-1 text-xs font-normal text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowDownToLine className="size-3.5" />}
          Apply
        </button>
        <button
          type="button"
          aria-label={selected ? `Apply and drop ${selected.name}` : "Apply and drop shelf entry"}
          title="Apply the entry and delete it from the shelf"
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
          aria-label="Refresh shelf"
          title="Refresh shelf"
          disabled={busy}
          onClick={() => void listQuery.refetch()}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={selected ? `Delete ${selected.name}` : "Delete shelf entry"}
          title="Delete this shelf entry (the worktree is untouched)"
          disabled={busy || !selected}
          onClick={() => selected && setConfirm({ action: "drop", id: selected.id })}
          className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-destructive disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto py-1.5">
        {listQuery.isPending ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">Loading shelf…</p>
        ) : listQuery.isError ? (
          <p className="px-3 py-2 text-xs text-warn">Shelf unavailable.</p>
        ) : entries.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No shelved changes yet. Right-click files in Commit and choose Shelve….
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {entries.map((entry) => {
              const active = selected?.id === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  title={entry.name}
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
                    {entry.name}
                  </span>
                  <span className="tnum text-[10px] text-muted-foreground/70">
                    {new Date(entry.createdAt * 1000).toLocaleString()}
                    {entry.branch ? ` · ${entry.branch}` : ""} · {entry.files.length} file
                    {entry.files.length === 1 ? "" : "s"}
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
              heading="Shelved Files"
              truncated={false}
              selected={preview?.path ?? null}
              onSelect={(path) => setPreviewPath(path)}
            />

            {detailQuery.isPending ? (
              <p className="px-3 py-1 text-xs text-muted-foreground">Loading preview…</p>
            ) : (
              preview && <ShelfFilePreview file={preview} />
            )}
          </div>
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

/** Read-only unified preview of one shelved file. */
function ShelfFilePreview({ file }: { file: FileDiff }) {
  return (
    <div className="mt-1 border-t border-rule px-3 py-1.5">
      <p className="truncate py-0.5 font-mono text-[11px] text-muted-foreground">{file.path}</p>
      <div className="max-h-64 overflow-auto rounded bg-deep-surface p-1.5 font-mono text-[11px] leading-5">
        {file.hunks.length === 0 && (
          <p className="text-muted-foreground">No hunks — empty change.</p>
        )}
        {file.hunks.map((hunk, i) => (
          <div key={i} className="mb-1 last:mb-0">
            <p className="text-muted-foreground/70">
              @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
            </p>
            {hunk.lines.map((line, j) => (
              <p
                key={j}
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
