import { SidebarTaskRow } from "@/components/SidebarTaskRow";
import { isTaskGroupPinned } from "@/lib/taskGroups";
import { cn } from "@/lib/utils";

import { SIDEBAR_BODY_ID } from "./modes";
import { ChatsRow, EmptyRow, ProjectRow, ShelfRow } from "./rows";
import type { useSidebarTree } from "./useSidebarTree";

type Tree = ReturnType<typeof useSidebarTree>;

/** The virtualised project → task tree the Tasks and Mission Control modes show. */
export function TaskTree({
  tree,
  openTaskId,
  onOpenTask,
  onOpenProject,
  onAddProject,
  onSettleFinishedTurns,
}: {
  tree: Tree;
  openTaskId: string | null;
  onOpenTask: (id: string) => void;
  onOpenProject: (name: string) => void;
  onAddProject: () => void;
  onSettleFinishedTurns?: (ids: string[]) => void;
}) {
  const {
    handlePin,
    nowSec,
    pinned,
    rows,
    scrollRef,
    setDeletingShelf,
    setSettlingProject,
    settleMarkedIds,
    taskGroupIndex,
    totalSize,
    toggleProject,
    toggleShelf,
    toggleTask,
    virtualItems,
  } = tree;

  return (
    <div
      ref={scrollRef}
      id={SIDEBAR_BODY_ID}
      className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-gutter:stable]"
    >
      <div className="relative w-full" style={{ height: totalSize }}>
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          return (
            <div
              key={row.key}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full"
              style={{
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.kind === "empty" ? (
                <EmptyRow
                  row={row}
                  onAddProject={row.key === "empty:workspace" ? onAddProject : undefined}
                />
              ) : row.kind === "project" ? (
                <ProjectRow
                  row={row}
                  onToggle={toggleProject}
                  onOpenProject={onOpenProject}
                  onSettle={onSettleFinishedTurns ?? (() => {})}
                  onSettleHover={
                    onSettleFinishedTurns
                      ? (hovering) => setSettlingProject(hovering ? row.name : null)
                      : undefined
                  }
                />
              ) : row.kind === "chats" ? (
                <ChatsRow row={row} onToggle={toggleProject} />
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
                    ancestorLines={row.ancestorLines}
                    isLast={row.isLast}
                    activeLane={row.activeLane}
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
  );
}
