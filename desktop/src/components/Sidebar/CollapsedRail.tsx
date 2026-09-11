import { Bot, PanelLeft, Plus, Settings } from "lucide-react";

import { TooltipProvider } from "@/components/ui/tooltip";
import UpdateControl from "@/components/UpdateControl";
import type { ConnectionState } from "@/daemon";
import { useUi } from "@/store/ui";
import type { View } from "@/store/ui";

import { ConnectionDot } from "./ConnectionDot";
import { NAV } from "./nav";
import { RailButton } from "./RailButton";

export function CollapsedRail({
  view,
  openTaskId,
  connection,
  connectionError,
  agentUpdates,
  navCount,
  onToggleCollapsed,
  onSelectView,
  onNewTask,
  onOpenSettings,
}: {
  view: View;
  openTaskId: string | null;
  connection: ConnectionState;
  connectionError: string | null;
  agentUpdates: number;
  navCount: (id: View) => number;
  onToggleCollapsed: () => void;
  onSelectView: (view: View) => void;
  onNewTask: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <aside
        data-testid="sidebar"
        data-collapsed
        className="flex h-full min-h-0 min-w-0 flex-col items-center gap-1 border-r border-border bg-card py-2"
      >
        <div className="flex h-10 shrink-0 items-center">
          <RailButton
            icon={PanelLeft}
            label="Expand sidebar"
            onClick={onToggleCollapsed}
            ariaExpanded={false}
          />
        </div>
        <ConnectionDot connection={connection} connectionError={connectionError} />
        <RailButton icon={Plus} label="New task" onClick={onNewTask} />
        <span aria-hidden className="my-1 h-px w-6 bg-border" />
        {NAV.map((item) => (
          <RailButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            active={view === item.id && !openTaskId}
            count={navCount(item.id)}
            hot={item.attention}
            onClick={() => onSelectView(item.id)}
          />
        ))}
        <span className="flex-1" />
        {agentUpdates > 0 && (
          <RailButton
            icon={Bot}
            label={`${agentUpdates} agent update${agentUpdates === 1 ? "" : "s"} available`}
            onClick={() => {
              useUi.getState().setSettingsPage("agents");
              onOpenSettings();
            }}
          />
        )}
        <UpdateControl daemonConnected={connection === "connected"} />
        <RailButton icon={Settings} label="Settings" onClick={onOpenSettings} />
      </aside>
    </TooltipProvider>
  );
}
