import { Bot } from "lucide-react";

import { useAgentUpdatesCount } from "@/hooks/useAgentUpdates";
import { cn } from "@/lib/utils";
import { useUi } from "@/store/ui";

/**
 * Agent CLI updates are applied in Settings → Agents, but nobody opens that
 * page to check. This sits beside the app-update banner so both kinds of
 * update announce themselves from outside Settings, and only while one waits.
 */
export function AgentUpdateBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const count = useAgentUpdatesCount();
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={() => {
        useUi.getState().setSettingsPage("agents");
        onOpenSettings();
      }}
      title="Open Settings → Agents to update"
      className={cn(
        "flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium",
        "bg-primary text-primary-foreground",
        "shadow-sm transition-opacity hover:opacity-90",
      )}
    >
      <Bot className="size-3.5" />
      {`${count} agent update${count === 1 ? "" : "s"} available`}
    </button>
  );
}
