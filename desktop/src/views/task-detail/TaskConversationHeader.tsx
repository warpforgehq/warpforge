import type { ReactNode } from "react";

import { PaneHeader, PaneWindowControls } from "@/components/workspace";

export interface TaskConversationHeaderProps {
  /** The workspace pane is open beside the conversation. */
  showDiff: boolean;
  setShowDiff: (show: boolean) => void;
  /** Fold the conversation away, leaving the workspace full width. */
  toggleChat: () => void;
  /** Which half of the split the conversation occupies. */
  side: "left" | "right";
  /** Controls rendered before the window controls. */
  extraActions?: ReactNode;
}

/**
 * Conversation pane header, with the same window controls as the surface pane
 * so the two halves of the split behave alike.
 */
export function TaskConversationHeader({
  showDiff,
  setShowDiff,
  toggleChat,
  side,
  extraActions,
}: TaskConversationHeaderProps) {
  return (
    <PaneHeader
      title="Conversation"
      titleSize="compact"
      actions={
        <>
          {extraActions}
          <PaneWindowControls
            focused={!showDiff}
            side={side}
            expandLabel="Focus conversation"
            hideLabel="Hide conversation"
            onExpand={() => setShowDiff(false)}
            onHide={toggleChat}
            onRestore={() => setShowDiff(true)}
          />
        </>
      }
    />
  );
}
