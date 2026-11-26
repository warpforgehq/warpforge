import { PaneHeader, type SurfaceTab } from "@/components/workspace";

import type { TaskSurface } from "../../store/ui";

export interface TaskSurfaceHeaderProps {
  activeSurface: TaskSurface;
  tabs: readonly SurfaceTab[];
  className?: string;
}

/**
 * Names the surface the side pane is showing. Switching lives in the rail and
 * the pane's window controls sit at the far end of the title row.
 * @param props see `TaskSurfaceHeaderProps`
 * @returns the header
 */
export function TaskSurfaceHeader({ activeSurface, tabs, className }: TaskSurfaceHeaderProps) {
  const tab = tabs.find((candidate) => candidate.id === activeSurface) ?? tabs[0];
  return (
    <PaneHeader
      className={className}
      icon={tab?.icon}
      title={tab?.label ?? "Workspace"}
      titleSize="compact"
    />
  );
}
