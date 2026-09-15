import { DEFAULT_INBOX_FILTERS, type InboxFilters } from "@/lib/inboxFilters";

import {
  clampSidebarWidth,
  SIDEBAR_WIDTH_DEFAULT,
  type UiSlice,
} from "./types";

export interface LayoutState {
  missionControlTab: "live" | "needs" | "failed" | "pinned";
  sidebarWidth: number;
  /** Sidebar shrunk to its icon rail. */
  sidebarCollapsed: boolean;
  /** File-tree panel inside the Files surface collapsed to a thin rail. */
  filesPanelCollapsed: boolean;
  /** Service/port-forward sidebar inside the Runtime surface collapsed. */
  runtimeSidebarCollapsed: boolean;
  /** Changes rail inside the Diff surface collapsed. */
  diffPanelCollapsed: boolean;
  /** File rail inside a pull request's Code tab collapsed. */
  pullFilesPanelCollapsed: boolean;
  /** Which pull request the review column is showing: `inboxItemKey(pr)`. */
  inboxSelectedKey: string | null;
  /** The inbox list's own filters. Search is dropped on the way to storage. */
  inboxFilters: InboxFilters;

  setMissionControlTab: (tab: "live" | "needs" | "failed" | "pinned") => void;
  setSidebarWidth: (w: number) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleFilesPanelCollapsed: () => void;
  toggleRuntimeSidebarCollapsed: () => void;
  toggleDiffPanelCollapsed: () => void;
  togglePullFilesPanelCollapsed: () => void;
  setFilesPanelCollapsed: (collapsed: boolean) => void;
  setRuntimeSidebarCollapsed: (collapsed: boolean) => void;
  setDiffPanelCollapsed: (collapsed: boolean) => void;
  setPullFilesPanelCollapsed: (collapsed: boolean) => void;
  setInboxSelectedKey: (key: string | null) => void;
  setInboxFilters: (filters: InboxFilters) => void;
}

export const createLayoutSlice: UiSlice<LayoutState> = (set) => ({
  missionControlTab: "live",
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  sidebarCollapsed: false,
  filesPanelCollapsed: false,
  runtimeSidebarCollapsed: false,
  diffPanelCollapsed: false,
  pullFilesPanelCollapsed: false,
  inboxSelectedKey: null,
  inboxFilters: DEFAULT_INBOX_FILTERS,

  setMissionControlTab: (missionControlTab) => set({ missionControlTab }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: clampSidebarWidth(sidebarWidth) }),
  toggleSidebarCollapsed: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  toggleFilesPanelCollapsed: () => set((s) => ({ filesPanelCollapsed: !s.filesPanelCollapsed })),
  toggleRuntimeSidebarCollapsed: () =>
    set((s) => ({ runtimeSidebarCollapsed: !s.runtimeSidebarCollapsed })),
  toggleDiffPanelCollapsed: () => set((s) => ({ diffPanelCollapsed: !s.diffPanelCollapsed })),
  togglePullFilesPanelCollapsed: () =>
    set((s) => ({ pullFilesPanelCollapsed: !s.pullFilesPanelCollapsed })),
  setFilesPanelCollapsed: (filesPanelCollapsed) => set({ filesPanelCollapsed }),
  setRuntimeSidebarCollapsed: (runtimeSidebarCollapsed) => set({ runtimeSidebarCollapsed }),
  setDiffPanelCollapsed: (diffPanelCollapsed) => set({ diffPanelCollapsed }),
  setPullFilesPanelCollapsed: (pullFilesPanelCollapsed) => set({ pullFilesPanelCollapsed }),
  setInboxSelectedKey: (inboxSelectedKey) => set({ inboxSelectedKey }),
  setInboxFilters: (inboxFilters) => set({ inboxFilters }),
});
