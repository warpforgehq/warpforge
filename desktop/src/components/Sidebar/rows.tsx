import { ArrowUpRight, CheckCheck, ChevronRight, Inbox, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";

import type { SidebarRow } from "./logic";

/**
 * Closes a project group with the history it hides: "12 done". Settled work is
 * archive material, but archive you cannot open is just deletion, so the row
 * stays one click from the tasks — quiet enough to skip, present enough to find.
 */
/** "Delete N finished tasks?", with the real kept split stated up front — the
 *  confirmation the user commits to must match what the daemon will actually
 *  do, not just the count on the shelf's disclosure. */
function deleteShelfTitle(row: Extract<SidebarRow, { kind: "shelf" }>): string {
  const count = row.deletableIds.length;
  const base = `Delete ${count} finished task${count === 1 ? "" : "s"}`;
  if (row.keptCount === 0) return base;
  return `${base} (${row.keptCount} kept — worktree still has uncommitted changes)`;
}

export function ShelfRow({
  row,
  onToggle,
  onDelete,
}: {
  row: Extract<SidebarRow, { kind: "shelf" }>;
  onToggle: (project: string) => void;
  onDelete: (row: Extract<SidebarRow, { kind: "shelf" }>) => void;
}) {
  const deleteTitle = deleteShelfTitle(row);
  return (
    <div className="group/shelf relative">
      <button
        type="button"
        data-shelf={row.project}
        aria-expanded={row.expanded}
        aria-label={`${row.expanded ? "Hide" : "Show"} ${row.count} done task${
          row.count === 1 ? "" : "s"
        } in ${row.project}`}
        onClick={() => onToggle(row.project)}
        className="flex h-6 w-full items-center gap-1.5 rounded-md pl-2 pr-7 text-left text-[11px] text-muted-foreground/45 transition-colors hover:bg-accent/50 hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", row.expanded && "rotate-90")}
        />
        <span className="tnum">{row.count}</span>
        <span className="min-w-0 truncate">done</span>
      </button>
      {row.deletableIds.length > 0 && (
        <button
          type="button"
          aria-label={deleteTitle}
          title={deleteTitle}
          onClick={() => onDelete(row)}
          className="pointer-events-none absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground/50 opacity-0 transition-opacity hover:bg-accent hover:text-destructive focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/shelf:pointer-events-auto group-hover/shelf:opacity-100"
        >
          <Trash2 className="size-3" />
        </button>
      )}
    </div>
  );
}

export function EmptyRow({ row }: { row: Extract<SidebarRow, { kind: "empty" }> }) {
  return (
    <div className="flex items-start gap-2 px-2.5 py-1.5 text-[11px] text-muted-foreground/50">
      <Inbox aria-hidden className="mt-px size-3.5 shrink-0 opacity-60" />
      <span className="min-w-0">
        {row.label}
        {row.hint && <span className="mt-0.5 block text-muted-foreground/40">{row.hint}</span>}
      </span>
    </div>
  );
}

export function ProjectRow({
  row,
  onToggle,
  onOpenProject,
  onSettle,
  onSettleHover,
}: {
  row: Extract<SidebarRow, { kind: "project" }>;
  onToggle: (name: string) => void;
  onOpenProject: (name: string) => void;
  onSettle: (ids: string[]) => void;
  /** True while the pointer (or focus) is on the bulk-settle button, so the
   *  tree can highlight exactly the rows it would settle. */
  onSettleHover?: (hovering: boolean) => void;
}) {
  const settle = row.settleIds.length > 0;
  const preview = row.settlePreview.some(Boolean) ? ` — ${row.settlePreview.join(", ")}` : "";
  const settleTitle = `Settle ${row.settleIds.length} finished turn${
    row.settleIds.length === 1 ? "" : "s"
  } with no changes (reversible per task)${preview}`;
  return (
    <div className="group/proj relative mt-1">
      <button
        type="button"
        data-project={row.name}
        aria-expanded={row.expanded}
        aria-label={`${row.expanded ? "Collapse" : "Expand"} project ${row.name}`}
        onClick={() => onToggle(row.name)}
        className="flex h-7 w-full items-center gap-2 rounded-md pl-1 pr-2 text-left transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-muted-foreground/40 transition-transform",
            row.expanded && "rotate-90",
          )}
        />
        <span
          aria-hidden
          className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-primary/15 text-[10px] font-bold uppercase leading-none text-primary"
        >
          {row.name.slice(0, 1)}
        </span>
        <strong
          className={cn(
            "min-w-0 flex-1 truncate text-[12px] font-semibold tracking-tight",
            row.selected ? "text-foreground" : "text-foreground/70",
          )}
        >
          {row.name}
        </strong>
        {row.attentionCount > 0 && (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-warn transition-opacity group-hover/proj:opacity-0"
          />
        )}
        <span
          title={`${row.count} active task${row.count === 1 ? "" : "s"}`}
          className="tnum shrink-0 text-[11px] text-muted-foreground/45 transition-opacity group-hover/proj:opacity-0"
        >
          {row.count}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Open ${row.name} in Projects`}
        title="Open in Projects"
        onClick={() => onOpenProject(row.name)}
        className="pointer-events-none absolute right-1 top-1/2 grid size-[22px] -translate-y-1/2 place-items-center rounded text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/proj:pointer-events-auto group-hover/proj:opacity-100"
      >
        <ArrowUpRight className="size-3.5" />
      </button>
      {settle && (
        <button
          type="button"
          aria-label={settleTitle}
          title={settleTitle}
          onClick={() => onSettle(row.settleIds)}
          onMouseEnter={() => onSettleHover?.(true)}
          onMouseLeave={() => onSettleHover?.(false)}
          onFocus={() => onSettleHover?.(true)}
          onBlur={() => onSettleHover?.(false)}
          className="pointer-events-none absolute right-[30px] top-1/2 grid size-[22px] -translate-y-1/2 place-items-center rounded text-muted-foreground/70 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/proj:pointer-events-auto group-hover/proj:opacity-100"
        >
          <CheckCheck className="size-3.5" />
        </button>
      )}
    </div>
  );
}
