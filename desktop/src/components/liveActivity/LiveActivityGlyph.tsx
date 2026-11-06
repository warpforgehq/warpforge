import {
  Activity,
  PlugZap,
  Server,
  ShieldCheck,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";

import { useLiveItems } from "@/hooks/useLiveItems";
import {
  type LiveItem,
  type LiveKind,
  liveItemLabel,
  liveState,
  liveTally,
} from "@/lib/liveActivity";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<LiveKind, LucideIcon> = {
  keeper: ShieldCheck,
  portforward: PlugZap,
  service: Server,
  terminal: TerminalSquare,
};

/**
 * A compact mark for what is live: the kind's icon when every item shares one,
 * a generic one otherwise; red when anything failed. The title lists each item.
 */
export function LiveActivityGlyph({
  items,
  receded = false,
}: {
  items: readonly LiveItem[];
  receded?: boolean;
}) {
  const state = liveState(liveTally(items));
  if (!state) return null;
  const kind = items[0].kind;
  const Icon = items.every((item) => item.kind === kind) ? KIND_ICON[kind] : Activity;
  const summary = items.map(liveItemLabel).join("\n");
  return (
    <span
      data-live-activity={state}
      title={summary}
      className={cn("inline-flex shrink-0", receded && "opacity-50")}
    >
      <Icon
        aria-hidden
        className={cn("size-3", state === "failed" ? "text-destructive" : "text-ok/80")}
      />
      <span className="sr-only">{summary}</span>
    </span>
  );
}

/** The task's own live items; project services show on the project row instead. */
export function TaskLiveGlyph({
  project,
  taskId,
  receded,
}: {
  project: string;
  taskId: string;
  receded: boolean;
}) {
  const items = useLiveItems(project, taskId).filter((item) => item.scope === "task");
  return <LiveActivityGlyph items={items} receded={receded} />;
}

/** Services, port-forwards and project-level terminals of one project. */
export function ProjectLiveGlyph({ project }: { project: string }) {
  return <LiveActivityGlyph items={useLiveItems(project, null)} />;
}
