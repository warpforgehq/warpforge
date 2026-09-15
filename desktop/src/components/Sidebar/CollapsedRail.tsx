import { Bot, PanelLeftOpen, Plus, Settings } from "lucide-react";
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useRef, useState } from "react";

import { AgentLogo } from "@/components/AgentLogo";
import UpdateControl from "@/components/UpdateControl";
import type { ConnectionState } from "@/daemon";
import { taskLabel } from "@/lib/taskLabel";
import { cn } from "@/lib/utils";
import type { TaskInfo } from "@/protocol";
import { useUi } from "@/store/ui";
import type { GlobalView, View } from "@/store/ui";

import { SIDEBAR_STATE_META, type SidebarTaskState } from "./logic";
import { NAV } from "./nav";
import { RailButton } from "./RailButton";
import { SEGMENTS, type SidebarSegment } from "./segments";

export interface LiveLaneItem {
  task: TaskInfo;
  state: SidebarTaskState;
  attention: boolean;
}

/**
 * The collapsed rail. Not a narrower sidebar — a 48px column whose first job is
 * *presence*: what is running and who is waiting stays visible in the live lane,
 * navigation is secondary. Content is pinned to a fixed 48px inner column so
 * icons do not drift while the panel width animates.
 */
export function CollapsedRail({
  view,
  openTaskId,
  connection,
  connectionError,
  agentUpdates,
  liveLane,
  navCount,
  segment,
  onToggleCollapsed,
  onSelectView,
  onSelectSegment,
  onNewTask,
  onOpenTask,
  onOpenSettings,
}: {
  view: View;
  openTaskId: string | null;
  connection: ConnectionState;
  connectionError: string | null;
  agentUpdates: number;
  liveLane: { tasks: LiveLaneItem[]; overflow: number };
  navCount: (id: GlobalView) => number;
  segment: SidebarSegment;
  onToggleCollapsed: () => void;
  onSelectView: (view: GlobalView) => void;
  onSelectSegment: (segment: SidebarSegment) => void;
  onNewTask: () => void;
  onOpenTask: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [tabbable, setTabbable] = useState("toggle");
  const roving = useCallback(
    (key: string) => ({
      onFocus: () => setTabbable(key),
      tabIndex: tabbable === key ? 0 : -1,
    }),
    [tabbable],
  );

  // One tab stop for the whole rail; arrows, Home and End move within it.
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

  return (
    <aside
      ref={rootRef}
      data-testid="sidebar"
      data-collapsed
      data-connection-error={connectionError ?? undefined}
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Sidebar"
      onKeyDown={onKeyDown}
      className="flex h-full min-h-0 flex-col items-start border-r border-edge bg-card py-2"
    >
      <div className="flex w-14 shrink-0 flex-col items-center gap-1 px-2">
        <div className="relative flex size-8 items-center justify-center">
          <span
            aria-hidden
            className={cn(
              "absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full",
              connection === "connected" ? "bg-primary" : "bg-warn",
            )}
          />
          <span aria-hidden className="select-none text-[11px] font-bold tracking-tight">
            W
          </span>
        </div>
        {/* Explicit expand: the identity mark above is a logo, not a control,
            so the panel icon owns the action and matches the expanded
            sidebar's `PanelLeftClose`. First stop in the rail's roving order. */}
        <RailButton
          icon={PanelLeftOpen}
          label="Expand sidebar"
          shortcut="⌘\"
          onClick={onToggleCollapsed}
          ariaExpanded={false}
          {...roving("toggle")}
        />
        <RailButton
          icon={Plus}
          label="New task"
          shortcut="⌘N"
          onClick={onNewTask}
          {...roving("new-task")}
        />
      </div>

      <Rule />

      <div className="flex w-14 shrink-0 flex-col items-center gap-1 px-2">
        {SEGMENTS.map((item) => (
          <RailButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={segment === item.id}
            count={item.id === "inbox" ? navCount("inbox") : undefined}
            hot={item.id === "inbox" && navCount("inbox") > 0}
            onClick={() => onSelectSegment(item.id)}
            {...roving(`segment:${item.id}`)}
          />
        ))}
        {NAV.map((item) => (
          <RailButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={view === item.id && !openTaskId}
            count={navCount(item.id)}
            hot={item.attention && navCount(item.id) > 0}
            onClick={() => onSelectView(item.id)}
            {...roving(`nav:${item.id}`)}
          />
        ))}
      </div>

      {liveLane.tasks.length > 0 && (
        <>
          <Rule />
          <div className="flex w-14 shrink-0 flex-col items-center gap-1 px-2">
            {liveLane.tasks.map((item) => (
              <LiveChip
                key={item.task.id}
                item={item}
                active={openTaskId === item.task.id}
                onClick={() => onOpenTask(item.task.id)}
                {...roving(`live:${item.task.id}`)}
              />
            ))}
            {liveLane.overflow > 0 && (
              <RailButton
                label={`${liveLane.overflow} more needing attention`}
                onClick={onToggleCollapsed}
                {...roving("live:overflow")}
              >
                <span className="tnum text-[11px] text-muted-foreground/70">
                  +{liveLane.overflow}
                </span>
              </RailButton>
            )}
          </div>
        </>
      )}

      <span className="flex-1" />

      <Rule />

      <div className="flex w-14 shrink-0 flex-col items-center gap-1 px-2">
        {agentUpdates > 0 && (
          <RailButton
            icon={Bot}
            label={`${agentUpdates} agent update${agentUpdates === 1 ? "" : "s"} available`}
            onClick={() => {
              useUi.getState().setSettingsPage("agents");
              onOpenSettings();
            }}
            {...roving("agent-updates")}
          />
        )}
        <UpdateControl daemonConnected={connection === "connected"} />
        <RailButton
          icon={Settings}
          label="Settings"
          onClick={onOpenSettings}
          {...roving("settings")}
        />
      </div>
    </aside>
  );
}

/** A 1px full-bleed rule, not a floating stub inside the 48px column. */
function Rule() {
  return <span aria-hidden className="my-1 h-px w-full shrink-0 bg-rule" />;
}

function LiveChip({
  item,
  active,
  onClick,
  onFocus,
  tabIndex,
}: {
  item: LiveLaneItem;
  active: boolean;
  onClick: () => void;
  onFocus: () => void;
  tabIndex: number;
}) {
  const label = taskLabel(item.task);
  const meta = SIDEBAR_STATE_META[item.state];
  return (
    <button
      type="button"
      data-rail-item
      data-live-task={item.task.id}
      data-task-state={item.state}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onClick={onClick}
      aria-label={`${label} — ${meta.label}`}
      aria-current={active ? "true" : undefined}
      className={cn(
        "relative grid size-7 place-items-center rounded-md transition-[color,background-color,transform] duration-100 ease-[var(--ease-out)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        active ? "bg-accent/40" : "hover:bg-accent/40",
      )}
    >
      <AgentLogo agentId={item.task.agent} displayName={item.task.agent} className="size-4" />
      <span
        aria-hidden
        className={cn(
          "absolute bottom-0 right-0 size-1.5 rounded-full ring-2 ring-card",
          meta.toneClass.replace(/^text-/, "bg-"),
        )}
      />
    </button>
  );
}
