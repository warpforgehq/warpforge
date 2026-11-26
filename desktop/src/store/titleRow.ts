import { create } from "zustand";

/**
 * What the open view lends the title row: where its side pane starts, so the
 * row can draw the split line above it, and a slot to portal controls into.
 */
interface TitleRowState {
  /** Viewport x of the side pane's left edge, or null when it is not shown. */
  splitX: number | null;
  /** Element the conversation's controls portal into. */
  slot: HTMLElement | null;
  /** Element the side pane's header portals into, right of the split line. */
  surfaceSlot: HTMLElement | null;
  /** Element the task's git and workspace controls portal into. */
  metaSlot: HTMLElement | null;
  /** The side pane owns the whole width; the row drops the task tabs. */
  paneFull: boolean;
  /** Element the side pane's window controls portal into, at the row's end. */
  paneSlot: HTMLElement | null;
  /** The split handle is hovered or dragged; the row lights its line too. */
  splitHot: boolean;
  setSplitX: (x: number | null) => void;
  setSlot: (slot: HTMLElement | null) => void;
  setSurfaceSlot: (slot: HTMLElement | null) => void;
  setMetaSlot: (slot: HTMLElement | null) => void;
  setSplitHot: (hot: boolean) => void;
  setPaneSlot: (slot: HTMLElement | null) => void;
  setPaneFull: (full: boolean) => void;
}

export const useTitleRow = create<TitleRowState>()((set) => ({
  splitX: null,
  slot: null,
  surfaceSlot: null,
  metaSlot: null,
  splitHot: false,
  paneSlot: null,
  paneFull: false,
  setSplitX: (splitX) => set({ splitX }),
  setSlot: (slot) => set({ slot }),
  setSurfaceSlot: (surfaceSlot) => set({ surfaceSlot }),
  setMetaSlot: (metaSlot) => set({ metaSlot }),
  setSplitHot: (splitHot) => set({ splitHot }),
  setPaneSlot: (paneSlot) => set({ paneSlot }),
  setPaneFull: (paneFull) => set({ paneFull }),
}));
