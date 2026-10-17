import { create } from "zustand";

import type { Smith } from "../protocol";

interface SmithsState {
  smiths: Record<string, Smith>;
  loaded: boolean;
  /** Replace the list; later entries win on the same id. */
  load: (smiths: Smith[]) => void;
  upsert: (smith: Smith) => void;
  remove: (id: string) => void;
  /** Thread turns that had ended when each teammate's page was last open, by
   *  Smith id. In memory: transcripts are refetched after a reload. */
  seenTurns: Record<string, number>;
  markTurnsSeen: (id: string, turns: number) => void;
}

/** The Smiths (ADR 0027), app-wide: Team, the feed's labels, mentions and the
 *  board's assignees all read them. Not persisted. */
export const useSmithsStore = create<SmithsState>()((set) => ({
  load: (smiths) => set({ loaded: true, smiths: Object.fromEntries(smiths.map((s) => [s.id, s])) }),
  loaded: false,
  markTurnsSeen: (id, turns) =>
    set((state) =>
      state.seenTurns[id] === turns ? {} : { seenTurns: { ...state.seenTurns, [id]: turns } },
    ),
  seenTurns: {},
  remove: (id) =>
    set((state) => {
      const smiths = { ...state.smiths };
      delete smiths[id];
      return { smiths };
    }),
  smiths: {},
  upsert: (smith) => set((state) => ({ smiths: { ...state.smiths, [smith.id]: smith } })),
}));
