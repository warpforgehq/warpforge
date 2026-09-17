import type { ReactNode } from "react";

import {
  PaneHeader,
  PaneWindowControls,
  type SurfaceTab,
  surfaceSummary,
} from "@/components/workspace";

import type { TaskSurface } from "../../store/ui";

export interface TaskSurfaceHeaderProps {
  activeSurface: TaskSurface;
  tabs: readonly SurfaceTab[];
  /** The workspace owns the split: the conversation is folded away. */
  workspaceFocused: boolean;
  onFocusWorkspace: () => void;
  /** Fold the workspace away, leaving the conversation full width. */
  onHideSurface: () => void;
  onRestore: () => void;
  /** Which half of the split the workspace occupies. */
  side: "left" | "right";
  /** Extra controls rendered alongside the window controls. */
  extraActions?: ReactNode;
}

/**
 * Says which surface the pane is showing and what it holds. Switching lives in
 * the rail, so this header names the current surface instead of repeating the
 * whole set as a second row of controls.
 *
 * Two separate window controls, not one toggle: "make this full width" and
 * "put this away" are different intents, and a lone maximize glyph hid the
 * second one behind the first pane's button.
 */
export function TaskSurfaceHeader({
  activeSurface,
  tabs,
  workspaceFocused,
  onFocusWorkspace,
  onHideSurface,
  onRestore,
  side,
  extraActions,
}: TaskSurfaceHeaderProps) {
  const tab = tabs.find((candidate) => candidate.id === activeSurface) ?? tabs[0];
  return (
    <PaneHeader
      icon={tab?.icon}
      title={tab?.label ?? "Workspace"}
      titleSize="compact"
      subtitle={tab ? surfaceSummary(tab) : undefined}
      actions={
        <>
          {extraActions}
          <PaneWindowControls
            focused={workspaceFocused}
            side={side}
            expandLabel="Focus workspace"
            hideLabel="Hide surface"
            onExpand={onFocusWorkspace}
            onHide={onHideSurface}
            onRestore={onRestore}
          />
        </>
      }
    />
  );
}
