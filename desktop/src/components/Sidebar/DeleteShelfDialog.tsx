import { ConfirmDialog } from "@/components/ConfirmDialog";

import type { SidebarRow } from "./logic";

export function DeleteShelfDialog({
  row,
  onCancel,
  onConfirm,
}: {
  row: Extract<SidebarRow, { kind: "shelf" }> | null;
  onCancel: () => void;
  onConfirm: (project: string) => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={row !== null}
      title="Delete finished tasks?"
      description={
        row &&
        `Delete ${row.deletableIds.length} finished task${
          row.deletableIds.length === 1 ? "" : "s"
        } in ${row.project}?${
          row.keptCount > 0
            ? ` ${row.keptCount} kept because ${
                row.keptCount === 1 ? "its worktree still has" : "their worktrees still have"
              } uncommitted changes.`
            : ""
        }`
      }
      confirmLabel="Delete"
      busyLabel="Deleting…"
      onCancel={onCancel}
      onConfirm={async () => {
        if (!row) return;
        await onConfirm(row.project);
      }}
    />
  );
}
