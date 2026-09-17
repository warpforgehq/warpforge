import { Minus, PanelLeftDashed, PanelRightDashed, Square } from "lucide-react";

import { FocusButton } from "./FocusButton";

export interface PaneWindowControlsProps {
  /** This pane owns the whole split. */
  focused: boolean;
  /** Which half of the split this pane sits in, so the restore glyph mirrors. */
  side?: "left" | "right";
  expandLabel: string;
  hideLabel: string;
  onExpand: () => void;
  onHide: () => void;
  onRestore: () => void;
}

/**
 * The window controls every task pane header shares: expand and hide while
 * the split is on, a single restore while this pane is focused. The restore
 * glyph is drawn on this pane's own side — chat left, workspace right, and
 * mirrored when the split is flipped — so it reads as "this pane, back where
 * it was" rather than as a generic split.
 */
export function PaneWindowControls({
  focused,
  side = "left",
  expandLabel,
  hideLabel,
  onExpand,
  onHide,
  onRestore,
}: PaneWindowControlsProps) {
  if (focused) {
    return (
      <FocusButton
        focused
        icon={side === "right" ? PanelRightDashed : PanelLeftDashed}
        label="Restore split view"
        onClick={onRestore}
      />
    );
  }
  return (
    <>
      <FocusButton focused={false} icon={Square} label={expandLabel} onClick={onExpand} />
      <FocusButton focused={false} icon={Minus} label={hideLabel} onClick={onHide} />
    </>
  );
}
