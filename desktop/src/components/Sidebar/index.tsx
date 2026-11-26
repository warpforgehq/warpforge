import { memo, useEffect, useState } from "react";

import { InboxListPane } from "@/components/inbox/InboxListPane";
import type { ConnectionState, DaemonState } from "@/daemon";
import { cn } from "@/lib/utils";
import type { SidebarMode, View } from "@/store/ui";
import { AutomationList } from "@/views/automations/AutomationList";

import { DeleteShelfDialog } from "./DeleteShelfDialog";
import { railSelection, SIDEBAR_BODY_ID, SIDEBAR_MODES } from "./modes";
import { PanelFooter, PanelHeader } from "./PanelChrome";
import { Rail } from "./Rail";
import { SettingsNav } from "./SettingsNav";
import { SmithsBody } from "./SmithsBody";
import { TaskTree } from "./TaskTree";
import { useSidebarTree } from "./useSidebarTree";

interface SidebarProps {
  state: DaemonState;
  view: View;
  /** What the rail has picked; the panel shows its context. */
  mode: SidebarMode;
  openTaskId: string | null;
  /** The panel is folded away, leaving the rail. */
  collapsed: boolean;
  /** Settings replace the panel's content while open. */
  settingsOpen?: boolean;
  /** False on windows too narrow for the panel: the rail stands alone. */
  canExpand?: boolean;
  /** Default to "looks fine" rather than forcing every caller (mainly tests)
      to pass connection state that has nothing to do with what they check. */
  connection?: ConnectionState;
  connectionError?: string | null;
  onToggleCollapsed: () => void;
  /** Picking a mode switches the panel and the main area. For Tasks the host
   *  restores the last task it can still find, else the selected project. */
  onSelectMode: (mode: SidebarMode) => void;
  onOpenTask: (id: string) => void;
  onNewTask: () => void;
  onOpenProject: (name: string) => void;
  onAddProject: () => void;
  onOpenSettings: () => void;
  onCloseSettings?: () => void;
  /** Bulk-settle every diff-less finished turn (the same reversible settle
   *  as the per-row check button). */
  onSettleFinishedTurns?: (ids: string[]) => void;
  /** Bulk-delete every settled task on a project's "N done" shelf. */
  onDeleteSettledShelf?: (project: string) => Promise<void>;
}

const noop = () => {};

/** How long the outgoing panel stays mounted while it fades. */
const PANEL_FADE_MS = 120;

function useTrailingFlag(value: boolean, delayMs: number): boolean {
  const [trailing, setTrailing] = useState(value);
  useEffect(() => {
    if (value === trailing) return;
    const timer = window.setTimeout(() => setTrailing(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, trailing, delayMs]);
  return trailing;
}

function Sidebar({
  state,
  view,
  mode,
  openTaskId,
  collapsed,
  settingsOpen = false,
  canExpand = true,
  connection = "connected",
  connectionError = null,
  onToggleCollapsed,
  onSelectMode,
  onOpenTask,
  onNewTask,
  onOpenProject,
  onAddProject,
  onOpenSettings,
  onCloseSettings = noop,
  onSettleFinishedTurns,
  onDeleteSettledShelf,
}: SidebarProps) {
  const tree = useSidebarTree(state, openTaskId);
  // An existing session can have Automations open with an older sidebar mode.
  const panelMode =
    view === "automations" && !openTaskId ? "automations" : mode === "automations" ? "tasks" : mode;
  const selection = railSelection(panelMode, settingsOpen);
  const panelHidden = collapsed || !canExpand;
  const trailingHidden = useTrailingFlag(panelHidden, PANEL_FADE_MS);
  const panelMounted = !panelHidden || !trailingHidden;
  const modeLabel = SIDEBAR_MODES.find((item) => item.id === panelMode)?.label ?? "Tasks";

  return (
    <div className="flex h-full min-h-0 min-w-0">
      <Rail
        selection={selection}
        openTaskId={openTaskId}
        collapsed={panelHidden}
        canExpand={canExpand}
        connection={connection}
        connectionError={connectionError}
        agentUpdates={tree.agentUpdates}
        liveLane={tree.liveLane}
        modeCount={tree.modeCount}
        onToggleCollapsed={onToggleCollapsed}
        onSelectMode={onSelectMode}
        onNewTask={onNewTask}
        onOpenTask={onOpenTask}
        onOpenSettings={onOpenSettings}
        onCloseSettings={onCloseSettings}
      />

      {panelMounted && (
        <aside
          data-testid="sidebar-panel"
          data-panel={selection}
          aria-hidden={panelHidden || undefined}
          className={cn(
            "flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden transition-opacity duration-[120ms] ease-[var(--ease-out)]",
            panelHidden ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          {selection === "settings" ? (
            <>
              <PanelHeader title="Settings" onBack={onCloseSettings} />
              <SettingsNav />
            </>
          ) : (
            <>
              <PanelHeader title={modeLabel} />
              {panelMode === "inbox" ? (
                <div id={SIDEBAR_BODY_ID} className="min-h-0 flex-1">
                  <InboxListPane
                    projects={tree.projectNames}
                    emptyHint={
                      tree.projectNames.length === 0
                        ? undefined
                        : "No open pull requests in your projects."
                    }
                    onAddProject={onAddProject}
                  />
                </div>
              ) : panelMode === "automations" ? (
                <div id={SIDEBAR_BODY_ID} className="min-h-0 flex-1">
                  {connection === "connected" && <AutomationList />}
                </div>
              ) : panelMode === "team" ? (
                <div id={SIDEBAR_BODY_ID} className="min-h-0 flex-1 overflow-y-auto">
                  <SmithsBody projects={tree.projectNames} tasks={state.snapshot.tasks} />
                </div>
              ) : (
                <TaskTree
                  tree={tree}
                  openTaskId={openTaskId}
                  onOpenTask={onOpenTask}
                  onOpenProject={onOpenProject}
                  onAddProject={onAddProject}
                  onSettleFinishedTurns={onSettleFinishedTurns}
                />
              )}
            </>
          )}
          <PanelFooter onOpenSettings={onOpenSettings} />
        </aside>
      )}

      <DeleteShelfDialog
        row={tree.deletingShelf}
        onCancel={() => tree.setDeletingShelf(null)}
        onConfirm={async (project) => {
          await onDeleteSettledShelf?.(project);
          tree.setDeletingShelf(null);
        }}
      />
    </div>
  );
}

export default memo(Sidebar);
