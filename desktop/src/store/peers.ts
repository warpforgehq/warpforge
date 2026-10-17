import { create } from "zustand";

import type { PeerControls, PeerMessage } from "../protocol";

interface PeersState {
  /** Feed records by id: the newest page, then live updates. */
  records: Record<number, PeerMessage>;
  controls: PeerControls;
  loaded: boolean;
  /** Replace the feed with a freshly loaded page; later records in the list
   *  win on the same id. */
  load: (records: PeerMessage[], controls: PeerControls) => void;
  upsert: (record: PeerMessage) => void;
  setControls: (controls: PeerControls) => void;
}

/** The peer feed (ADR 0026), kept app-wide: the Team view, its nav badge and
 *  the needs-you rail's limit alerts all read it. Not persisted. */
export const usePeersStore = create<PeersState>()((set) => ({
  controls: { mutedTasks: [], pausedProjects: [] },
  load: (records, controls) =>
    set({ controls, loaded: true, records: Object.fromEntries(records.map((r) => [r.id, r])) }),
  loaded: false,
  records: {},
  setControls: (controls) => set({ controls }),
  upsert: (record) => set((state) => ({ records: { ...state.records, [record.id]: record } })),
}));
