import { useState } from "react";

import { cn } from "@/lib/utils";

import type { FileDiff } from "../protocol";
import { CommitPane } from "./changes/CommitPane";
import { ShelveDialog } from "./changes/ShelveDialog";
import { ShelfTab } from "./changes/ShelfTab";
import { StashTab } from "./changes/StashTab";

type RailTab = "commit" | "shelf" | "stash";

/**
 * Changes rail shell: Commit / Shelf / Stash tabs around the panes that do
 * the work. Shelving is requested from the Commit pane (toolbar button or
 * context menu) and lands the user on the Shelf tab; the Stash tab is a
 * placeholder until stash support lands.
 */
export function ChangesRail({
  project,
  files,
  untrackedPaths,
  untrackedAvailable,
  selected,
  onSelect,
  taskId,
  onOpenFile,
  commitExpanded,
  onCommitExpandedChange,
  onCommitted,
  onRefresh,
}: {
  project: string;
  files: FileDiff[];
  /** Paths within `files` that git does not track yet. */
  untrackedPaths: string[];
  /** False when the untracked scan could not complete — the rail says so
   * instead of implying the project has no unversioned files. */
  untrackedAvailable: boolean;
  selected: string | null;
  onSelect: (path: string) => void;
  taskId: string;
  /** Open an ignored file for reading (it has no diff). Falls back to
   * `onSelect` when absent. */
  onOpenFile?: (path: string) => void;
  commitExpanded?: boolean;
  onCommitExpandedChange?: (expanded: boolean) => void;
  onCommitted: () => void;
  onRefresh: () => void;
}) {
  const [tab, setTab] = useState<RailTab>("commit");
  const [bundleDialog, setBundleDialog] = useState<{
    mode: "shelf" | "stash";
    paths: string[];
  } | null>(null);

  const tabs: { id: RailTab; label: string }[] = [
    { id: "commit", label: "Commit" },
    { id: "shelf", label: "Shelf" },
    { id: "stash", label: "Stash" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center gap-1 border-b border-rule px-2 pt-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-t px-2.5 py-1.5 text-xs font-medium transition-colors",
              tab === t.id
                ? "bg-secondary/60 text-foreground"
                : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === "commit" && (
          <CommitPane
            project={project}
            files={files}
            untrackedPaths={untrackedPaths}
            untrackedAvailable={untrackedAvailable}
            selected={selected}
            onSelect={onSelect}
            taskId={taskId}
            onOpenFile={onOpenFile}
            onShelveRequest={(paths) => setBundleDialog({ mode: "shelf", paths })}
            onStashRequest={(paths) => setBundleDialog({ mode: "stash", paths })}
            commitExpanded={commitExpanded}
            onCommitExpandedChange={onCommitExpandedChange}
            onCommitted={onCommitted}
            onRefresh={onRefresh}
          />
        )}
        {tab === "shelf" && <ShelfTab taskId={taskId} onRefresh={onRefresh} />}
        {tab === "stash" && <StashTab taskId={taskId} onRefresh={onRefresh} />}
      </div>

      <ShelveDialog
        mode={bundleDialog?.mode ?? "shelf"}
        paths={bundleDialog?.paths ?? null}
        taskId={taskId}
        onClose={() => setBundleDialog(null)}
        onShelved={() => {
          const mode = bundleDialog?.mode ?? "shelf";
          setBundleDialog(null);
          setTab(mode === "shelf" ? "shelf" : "stash");
          onRefresh();
        }}
      />
    </div>
  );
}
