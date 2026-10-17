import { create } from "zustand";

import type { Channel, PeerControls, PeerMessage } from "../protocol";

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
  /** Named channels by id; `#general` is implicit. */
  channels: Record<string, Channel>;
  setChannels: (channels: Channel[]) => void;
  upsertChannel: (channel: Channel) => void;
  removeChannel: (id: string) => void;
}

/** The peer feed (ADR 0026), kept app-wide: the Team view, its nav badge and
 *  the needs-you rail's limit alerts all read it. Not persisted. */
export const usePeersStore = create<PeersState>()((set) => ({
  channels: {},
  controls: { mutedTasks: [], pausedProjects: [] },
  load: (records, controls) =>
    set({ controls, loaded: true, records: Object.fromEntries(records.map((r) => [r.id, r])) }),
  loaded: false,
  records: {},
  removeChannel: (id) =>
    set((state) => {
      const channels = { ...state.channels };
      delete channels[id];
      return { channels };
    }),
  setChannels: (channels) => set({ channels: Object.fromEntries(channels.map((c) => [c.id, c])) }),
  setControls: (controls) => set({ controls }),
  upsertChannel: (channel) =>
    set((state) => ({ channels: { ...state.channels, [channel.id]: channel } })),
  upsert: (record) => set((state) => ({ records: { ...state.records, [record.id]: record } })),
}));
