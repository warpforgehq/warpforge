import type { PinnedTileLayout, UiSlice } from "./types";

export interface PinnedState {
  pinnedTaskIds: string[];
  pinnedLayout: Record<string, PinnedTileLayout>;

  togglePinnedTask: (id: string) => void;
  setPinnedTaskIds: (ids: string[]) => void;
  setPinnedLayout: (id: string, layout: PinnedTileLayout) => void;
}

export const createPinnedSlice: UiSlice<PinnedState> = (set) => ({
  pinnedTaskIds: [],
  pinnedLayout: {},

  setPinnedTaskIds: (pinnedTaskIds) => set({ pinnedTaskIds }),
  togglePinnedTask: (id) =>
    set((s) => {
      const isPinned = s.pinnedTaskIds.includes(id);
      if (isPinned) {
        const pinnedLayout = { ...s.pinnedLayout };
        delete pinnedLayout[id];
        return {
          pinnedTaskIds: s.pinnedTaskIds.filter((x) => x !== id),
          pinnedLayout,
        };
      }
      const y = Object.values(s.pinnedLayout).reduce((max, l) => Math.max(max, l.y + l.h), 0);
      return {
        pinnedTaskIds: [...s.pinnedTaskIds, id],
        pinnedLayout: {
          ...s.pinnedLayout,
          [id]: { x: 0, y, w: 2, h: 2 },
        },
      };
    }),
  setPinnedLayout: (id, layout) =>
    set((s) => ({
      pinnedLayout: { ...s.pinnedLayout, [id]: layout },
    })),
});
