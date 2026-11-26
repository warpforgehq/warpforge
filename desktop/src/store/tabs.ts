import { create } from "zustand";
import { persist } from "zustand/middleware";

/** How many closed tabs ⌘⇧T can bring back. */
const CLOSED_LIMIT = 20;

export interface TabsState {
  /** Task ids, in strip order. */
  open: string[];
  /** Most recently closed first. */
  closed: string[];
  /**
   * Add a tab for `id` unless it has one.
   * @param id task to show
   * @param after tab to place it right of; appended when absent
   */
  ensure: (id: string, after?: string | null) => void;
  /**
   * Close the tab for `id`.
   * @param id task whose tab closes
   * @returns the neighbour to show next (right, else left), or null
   */
  close: (id: string) => string | null;
  /**
   * Move a tab to another slot.
   * @param id tab to move
   * @param index destination slot in the current order
   */
  move: (id: string, index: number) => void;
  /**
   * Reopen the most recently closed tab that still has a task.
   * @param exists whether a task id is still on the board
   * @returns the reopened id, or null
   */
  reopen: (exists: (id: string) => boolean) => string | null;
  /**
   * Drop tabs whose task is gone.
   * @param exists whether a task id is still on the board
   */
  prune: (exists: (id: string) => boolean) => void;
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      open: [],
      closed: [],
      ensure: (id, after) => {
        const { open } = get();
        if (open.includes(id)) return;
        const at = after ? open.indexOf(after) : -1;
        const next = [...open];
        next.splice(at < 0 ? next.length : at + 1, 0, id);
        set({ open: next });
      },
      close: (id) => {
        const { open, closed } = get();
        const at = open.indexOf(id);
        if (at < 0) return null;
        const next = open.filter((tab) => tab !== id);
        set({
          open: next,
          closed: [id, ...closed.filter((tab) => tab !== id)].slice(0, CLOSED_LIMIT),
        });
        return next[at] ?? next[at - 1] ?? null;
      },
      move: (id, index) => {
        const { open } = get();
        const from = open.indexOf(id);
        if (from < 0) return;
        const next = open.filter((tab) => tab !== id);
        next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
        set({ open: next });
      },
      reopen: (exists) => {
        const { open, closed } = get();
        const id = closed.find((tab) => exists(tab) && !open.includes(tab)) ?? null;
        if (!id) return null;
        set({ open: [...open, id], closed: closed.filter((tab) => tab !== id) });
        return id;
      },
      prune: (exists) => {
        const { open, closed } = get();
        const keptOpen = open.filter(exists);
        const keptClosed = closed.filter(exists);
        if (keptOpen.length !== open.length || keptClosed.length !== closed.length) {
          set({ open: keptOpen, closed: keptClosed });
        }
      },
    }),
    { name: "wf-tabs", version: 1 },
  ),
);
