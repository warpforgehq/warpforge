import { PanelLeftClose, Plus, Settings } from "lucide-react";
import { memo, useCallback } from "react";

import { AgentUpdateBanner } from "@/components/AgentUpdateBanner";
import { SidebarTaskRow } from "@/components/SidebarTaskRow";
import { TooltipProvider } from "@/components/ui/tooltip";
import { UpdateBanner } from "@/components/UpdateBanner";
import UpdateControl from "@/components/UpdateControl";
import type { ConnectionState, DaemonState } from "@/daemon";
import { isTaskGroupPinned } from "@/lib/taskGroups";
import { cn } from "@/lib/utils";
import type { View } from "@/store/ui";

import { CollapsedRail } from "./CollapsedRail";
import { ConnectionDot } from "./ConnectionDot";
import { DeleteShelfDialog } from "./DeleteShelfDialog";
import { NAV } from "./nav";
import { EmptyRow, ProjectRow, ShelfRow } from "./rows";
import { useSidebarTree } from "./useSidebarTree";

interface SidebarProps {
  state: DaemonState;
  view: View;
  openTaskId: string | null;
  collapsed: boolean;
  /** Default to "looks fine" rather than forcing every caller (mainly tests)
      to pass connection state that has nothing to do with what they check. */
  connection?: ConnectionState;
  connectionError?: string | null;
  onToggleCollapsed: () => void;
  onSelectView: (view: View) => void;
  onOpenTask: (id: string) => void;
  onNewTask: () => void;
  onOpenProject: (name: string) => void;
  onOpenSettings: () => void;
  /** Bulk-settle every diff-less finished turn (the same reversible settle
   *  as the per-row check button). */
  onSettleFinishedTurns?: (ids: string[]) => void;
  /** Bulk-delete every settled task on a project's "N done" shelf. */
  onDeleteSettledShelf?: (project: string) => Promise<void>;
}

function Sidebar({
  state,
  view,
  openTaskId,
  collapsed,
  connection = "connected",
  connectionError = null,
  onToggleCollapsed,
  onSelectView,
  onOpenTask,
  onNewTask,
  onOpenProject,
  onOpenSettings,
  onSettleFinishedTurns,
  onDeleteSettledShelf,
}: SidebarProps) {
  const {
    agentUpdates,
    deletingShelf,
    handlePin,
    navCount,
    nowSec,
    pinned,
    rows,
    scrollRef,
    setDeletingShelf,
    setSettlingProject,
    settleMarkedIds,
    taskGroupIndex,
    toggleProject,
    toggleShelf,
    toggleTask,
    virtualizer,
  } = useSidebarTree(state, openTaskId);

  const handleOpenProjects = useCallback((name: string) => onOpenProject(name), [onOpenProject]);

  if (collapsed) {
    return (
      <CollapsedRail
        view={view}
        openTaskId={openTaskId}
        connection={connection}
        connectionError={connectionError}
        agentUpdates={agentUpdates}
        navCount={navCount}
        onToggleCollapsed={onToggleCollapsed}
        onSelectView={onSelectView}
        onNewTask={onNewTask}
        onOpenSettings={onOpenSettings}
      />
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <aside
        data-testid="sidebar"
        className="flex h-full min-h-0 min-w-0 flex-col border-r border-border bg-card"
      >
        <div
          data-tauri-drag-region="deep"
          className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3.5"
        >
          <div className="flex items-center gap-1.5">
            <strong className="select-none text-[11px] font-bold uppercase tracking-[0.2em] text-foreground">
              WARP<span className="text-primary">FORGE</span>
            </strong>
            <ConnectionDot connection={connection} connectionError={connectionError} />
          </div>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            aria-expanded
            className="grid size-6 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>

        <div className="shrink-0 px-2 pb-2 pt-2.5">
          <button
            type="button"
            onClick={onNewTask}
            className="flex h-8 w-full items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-2.5 text-left text-[13px] font-semibold text-primary transition-colors hover:border-primary/60 hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Plus className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">New task</span>
            <kbd className="tnum shrink-0 font-sans text-[10px] font-medium text-primary/60">
              ⌘N
            </kbd>
          </button>
        </div>

        <nav className="flex shrink-0 flex-col gap-px border-b border-border px-2 pb-2.5">
          {NAV.map((item) => {
            const active = view === item.id && !openTaskId;
            const count = navCount(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  active
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                )}
              >
                <item.icon
                  className={cn(
                    "size-4 shrink-0",
                    active ? "text-primary" : "text-muted-foreground/60",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      "tnum shrink-0 text-[11px]",
                      item.attention ? "font-semibold text-warn" : "text-muted-foreground/50",
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-gutter:stable]"
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (!row) return null;
              return (
                <div
                  key={row.key}
                  data-index={virtualRow.index}
                  className="absolute left-0 top-0 w-full [content-visibility:auto]"
                  style={{
                    containIntrinsicSize: `auto ${virtualRow.size}px`,
                    height: virtualRow.size,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {row.kind === "empty" ? (
                    <EmptyRow row={row} />
                  ) : row.kind === "project" ? (
                    <ProjectRow
                      row={row}
                      onToggle={toggleProject}
                      onOpenProject={handleOpenProjects}
                      onSettle={onSettleFinishedTurns ?? (() => {})}
                      onSettleHover={
                        onSettleFinishedTurns
                          ? (hovering) => setSettlingProject(hovering ? row.name : null)
                          : undefined
                      }
                    />
                  ) : row.kind === "shelf" ? (
                    <ShelfRow row={row} onToggle={toggleShelf} onDelete={setDeletingShelf} />
                  ) : (
                    <div
                      className={cn(
                        "transition-opacity",
                        settleMarkedIds?.has(row.task.id) && "opacity-40",
                      )}
                    >
                      <SidebarTaskRow
                        task={row.task}
                        state={row.state}
                        depth={row.depth}
                        active={openTaskId === row.task.id}
                        childCount={row.childCount}
                        expanded={row.expanded}
                        pinned={isTaskGroupPinned(taskGroupIndex, pinned, row.task.id)}
                        nowSec={nowSec}
                        onOpen={onOpenTask}
                        onToggle={toggleTask}
                        onPin={handlePin}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-1.5 border-t border-border px-2 py-2">
          <UpdateBanner />
          <AgentUpdateBanner onOpenSettings={onOpenSettings} />
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex h-8 flex-1 items-center gap-2.5 rounded-md px-2.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Settings className="size-4 shrink-0 text-muted-foreground/60" />
              Settings
            </button>
            {/* Update lives beside Settings, not buried inside it — the "new
                version" dot needs to stay visible the way it did in the topbar,
                just relocated rather than lost. */}
            <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
            <UpdateControl daemonConnected={connection === "connected"} />
          </div>
        </footer>
      </aside>

      <DeleteShelfDialog
        row={deletingShelf}
        onCancel={() => setDeletingShelf(null)}
        onConfirm={async (project) => {
          await onDeleteSettledShelf?.(project);
          setDeletingShelf(null);
        }}
      />
    </TooltipProvider>
  );
}

export default memo(Sidebar);
