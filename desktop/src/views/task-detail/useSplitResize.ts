import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Narrowest each side of the split may be dragged to. Reaching either one is
 * also what hides that side: the drag is tracked against these, so the moment
 * the hint appears is the moment releasing folds the pane away.
 */
const CHAT_MIN_WIDTH = 360;
export const WORKSPACE_MIN_WIDTH = 360;

/** Drag-to-resize and fold behaviour for the chat/workspace split. */
export function useSplitResize({
  chatOnRight,
  setShowChat,
  setShowDiff,
}: {
  chatOnRight: boolean;
  setShowChat: (open: boolean) => void;
  setShowDiff: (open: boolean) => void;
}) {
  const [workspaceSize, setWorkspaceSize] = useState<`${number}%`>("58%");
  const [resizing, setResizing] = useState(false);
  const [foldTarget, setFoldTarget] = useState<"chat" | "workspace" | null>(null);
  const foldTargetRef = useRef<"chat" | "workspace" | null>(null);
  const splitRef = useRef<HTMLDivElement>(null);

  const aimFold = useCallback((next: "chat" | "workspace" | null) => {
    if (foldTargetRef.current === next) return;
    foldTargetRef.current = next;
    setFoldTarget(next);
  }, []);

  // The library holds a dragged pane at its minimum and only folds it once the
  // pointer is half a minimum past that, which leaves a stretch of drag where
  // nothing moves. Tracking the pointer instead lets the hint and the fold
  // share one threshold, so what the hint promises is what releasing does.
  useEffect(() => {
    if (!resizing) return;
    const track = (event: PointerEvent) => {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect) return;
      const chatWidth = chatOnRight ? rect.right - event.clientX : event.clientX - rect.left;
      if (chatWidth < CHAT_MIN_WIDTH) aimFold("chat");
      else if (rect.width - chatWidth < WORKSPACE_MIN_WIDTH) aimFold("workspace");
      else aimFold(null);
    };
    const cancel = () => {
      aimFold(null);
      setResizing(false);
    };
    const release = () => {
      if (foldTargetRef.current === "chat") setShowChat(false);
      if (foldTargetRef.current === "workspace") setShowDiff(false);
      setFoldTarget(null);
      setResizing(false);
      // The library reports the dragged size from its own listener on the same
      // event; clearing a frame later means `handleChatResize` still sees the
      // fold and does not persist the width the drag ended on.
      requestAnimationFrame(() => {
        foldTargetRef.current = null;
      });
    };
    window.addEventListener("pointermove", track);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [aimFold, chatOnRight, resizing, setShowChat, setShowDiff]);

  const handleWorkspaceResize = useCallback((size: `${number}%`) => {
    if (foldTargetRef.current) return;
    setWorkspaceSize(size);
  }, []);

  return { foldTarget, handleWorkspaceResize, resizing, setResizing, splitRef, workspaceSize };
}
