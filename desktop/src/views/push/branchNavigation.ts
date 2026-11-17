import { create } from "zustand";

import { useUi } from "@/store/ui";

export const useBranchNavigation = create<{
  taskId: string | null;
  nonce: number;
}>()(() => ({ taskId: null, nonce: 0 }));

export function openBranchCommits() {
  const ui = useUi.getState();
  if (!ui.openTaskId) return;
  ui.setActiveSurface("diff");
  ui.setShowDiff(true);
  ui.setDiffPanelCollapsed(false);
  useBranchNavigation.setState((s) => ({ taskId: ui.openTaskId, nonce: s.nonce + 1 }));
}
