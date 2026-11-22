import { Bot, X } from "lucide-react";

import { useAgentUpdateKeys } from "@/hooks/useAgentUpdates";
import { cn } from "@/lib/utils";
import { useAgentUpdateDismissal } from "@/store/agentUpdates";
import { useUi } from "@/store/ui";

/**
 * Agent CLI updates are applied in Settings → Agents, but nobody opens that
 * page to check. This sits beside the app-update banner so both kinds of
 * update announce themselves from outside Settings, and only while one waits.
 */
export function AgentUpdateBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const keys = useAgentUpdateKeys();
  const count = keys.length;
  if (count === 0) return null;

  return (
    <div
      className={cn(
        "flex h-8 w-full shrink-0 items-center rounded-md text-[13px] font-medium",
        "bg-primary text-primary-foreground shadow-sm",
      )}
    >
      <button
        type="button"
        onClick={() => {
          useUi.getState().setSettingsPage("agents");
          onOpenSettings();
        }}
        title="Open Settings → Agents to update"
        className="flex h-full min-w-0 flex-1 items-center justify-center gap-1.5 pl-2.5 transition-opacity hover:opacity-90"
      >
        <Bot className="size-3.5" />
        {`${count} agent update${count === 1 ? "" : "s"} available`}
      </button>
      <button
        type="button"
        onClick={() => useAgentUpdateDismissal.getState().dismiss(keys)}
        title="Dismiss until the next release"
        aria-label="Dismiss agent updates"
        className="flex h-full shrink-0 items-center px-2 opacity-70 transition-opacity hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
