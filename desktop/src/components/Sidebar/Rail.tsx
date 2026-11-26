import { Bot, PanelLeftClose, PanelLeftOpen, Plus, Settings } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useRef, useState } from "react";

import UpdateControl from "@/components/UpdateControl";
import type { ConnectionState } from "@/daemon";
import { useUi, type GlobalView, type SidebarMode } from "@/store/ui";

import { ConnectionDot } from "./ConnectionDot";
import { LiveLane, type LiveLaneItem } from "./LiveLane";
import { SIDEBAR_BODY_ID, SIDEBAR_MODES, type RailSelection } from "./modes";
import { NAV } from "./nav";
import { RailButton, type RailBadge } from "./RailButton";
import { WarpforgeMark } from "./WarpforgeMark";

/** Rail width: a 36px target with 10px either side. */
export const RAIL_WIDTH = 56;

export interface RailProps {
  selection: RailSelection;
  openTaskId: string | null;
  collapsed: boolean;
  /** False where the window is too narrow for the panel: no toggle. */
  canExpand: boolean;
  connection: ConnectionState;
  connectionError: string | null;
  agentUpdates: number;
  liveLane: { tasks: LiveLaneItem[]; overflow: number };
  modeCount: (mode: SidebarMode) => number;
  onToggleCollapsed: () => void;
  onSelectView: (view: GlobalView) => void;
  onSelectMode: (mode: SidebarMode) => void;
  onNewTask: () => void;
  onOpenTask: (id: string) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}

function modeBadge(mode: SidebarMode, count: number): RailBadge | null {
  if (count <= 0 || mode === "tasks") return null;
  if (mode === "control") return { kind: "light" };
  return { hot: mode !== "team", kind: "count", value: count };
}

/**
 * The permanent rail: brand, New task, the modes, pins, live work, then
 * update and Settings. One tab stop; arrows, Home and End move within it.
 */
export function Rail({
  selection,
  openTaskId,
  collapsed,
  canExpand,
  connection,
  connectionError,
  agentUpdates,
  liveLane,
  modeCount,
  onToggleCollapsed,
  onSelectView,
  onSelectMode,
  onNewTask,
  onOpenTask,
  onOpenSettings,
  onCloseSettings,
}: RailProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [tabbable, setTabbable] = useState("new-task");
  const roving = useCallback(
    (key: string) => ({
      onFocus: () => setTabbable(key),
      tabIndex: tabbable === key ? 0 : -1,
    }),
    [tabbable],
  );

  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const items = Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>("[data-rail-item]") ?? [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const last = items.length - 1;
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % items.length;
    else if (event.key === "ArrowUp")
      next = current < 0 ? last : (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else next = last;
    event.preventDefault();
    items[next]?.focus();
  }, []);

  const settingsActive = selection === "settings";

  return (
    <aside
      ref={rootRef}
      data-testid="rail"
      data-collapsed={collapsed || undefined}
      data-connection-error={connectionError ?? undefined}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Sidebar"
      onKeyDown={onKeyDown}
      style={{ width: RAIL_WIDTH }}
      className="flex h-full min-h-0 shrink-0 flex-col items-center pb-2"
    >
      <div data-tauri-drag-region="deep" className="h-10 w-full shrink-0" />

      <div className="relative flex h-8 w-full shrink-0 items-center justify-center">
        <WarpforgeMark className="h-[15px] w-auto text-foreground" />
        <span className="absolute bottom-1 right-2.5 flex">
          <ConnectionDot connection={connection} connectionError={connectionError} />
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-center pt-2">
        <RailButton
          icon={Plus}
          label="New task"
          tooltip="New task · without a project ⌥⌘N"
          shortcut="⌘N"
          onClick={onNewTask}
          className="text-primary hover:bg-primary/15 hover:text-primary"
          {...roving("new-task")}
        />
      </div>

      <Rule />

      <nav aria-label="Modes" className="flex shrink-0 flex-col items-center gap-1">
        {SIDEBAR_MODES.map((item) => (
          <RailButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            tooltip={item.id === "team" ? "Smiths — AI teammates" : undefined}
            shortcut={`⌥⌘${item.key}`}
            active={selection === item.id}
            badge={modeBadge(item.id, modeCount(item.id))}
            ariaControls={SIDEBAR_BODY_ID}
            onClick={() => onSelectMode(item.id)}
            {...roving(`mode:${item.id}`)}
          />
        ))}
        {NAV.map((item) => (
          <RailButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={selection === item.id}
            onClick={() => onSelectView(item.id)}
            {...roving(`nav:${item.id}`)}
          />
        ))}
      </nav>

      <div
        role="group"
        aria-label="Pinned"
        data-rail-zone="pins"
        className="flex shrink-0 flex-col items-center gap-1 empty:hidden"
      />

      <div className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto overflow-x-hidden pt-1 [scrollbar-width:none]">
        {liveLane.tasks.length > 0 && <Rule />}
        <LiveLane
          lane={liveLane}
          openTaskId={openTaskId}
          onOpenTask={onOpenTask}
          onOverflow={() => onSelectMode("control")}
          roving={roving}
        />
      </div>

      <Rule />

      <div className="flex shrink-0 flex-col items-center gap-1">
        {collapsed && agentUpdates > 0 && (
          <RailButton
            icon={Bot}
            label={`${agentUpdates} agent update${agentUpdates === 1 ? "" : "s"} available`}
            badge={{ kind: "light" }}
            onClick={() => {
              useUi.getState().setSettingsPage("agents");
              onOpenSettings();
            }}
            {...roving("agent-updates")}
          />
        )}
        <UpdateControl daemonConnected={connection === "connected"} />
        {canExpand && (
          <RailButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            shortcut="⌘\"
            ariaExpanded={!collapsed}
            onClick={onToggleCollapsed}
            {...roving("toggle")}
          />
        )}
        <RailButton
          icon={Settings}
          label="Settings"
          active={settingsActive}
          onClick={settingsActive ? onCloseSettings : onOpenSettings}
          {...roving("settings")}
        />
      </div>
    </aside>
  );
}

function Rule() {
  return <span aria-hidden className="my-2 h-px w-6 shrink-0 bg-rule" />;
}
