import { create } from "zustand";

import { useUi } from "@/store/ui";

export const useBranchNavigation = create<{
  taskId: string | null;
}>()(() => ({ taskId: null }));

export function openBranchCommits() {
  const ui = useUi.getState();
  if (!ui.openTaskId) return;
  ui.setActiveSurface("diff");
  ui.setShowDiff(true);
  ui.setDiffPanelCollapsed(false);
  useBranchNavigation.setState({ taskId: ui.openTaskId });
}
