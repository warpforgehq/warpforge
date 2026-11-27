import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Something kept on the rail: a task, project, Smith, or team channel. */
export type Pin =
  | { kind: "task"; id: string }
  | { kind: "project"; id: string }
  | { kind: "space"; id: string }
  | { kind: "smith"; id: string }
  | { kind: "channel"; id: string; name: string };

/** Stable identity of a pin across kinds. */
export function pinKey(pin: Pin): string {
  return `${pin.kind}:${pin.id}`;
}

export interface PinsState {
  pins: Pin[];
  /** Append legacy dashboard pins without replacing existing rail pins. */
  migrateTaskPins: (ids: readonly string[]) => void;
  /**
   * Whether `pin` is on the rail.
   * @param pin the pin to look for
   * @returns true when pinned
   */
  has: (pin: Pin) => boolean;
  /**
   * Pin or unpin.
   * @param pin the pin to toggle; a new pin goes to the end
   */
  toggle: (pin: Pin) => void;
  /**
   * Move a pin to another slot.
   * @param key the pin's `pinKey`
   * @param index destination slot in the current order
   */
  move: (key: string, index: number) => void;
  /**
   * Drop pins whose target is gone.
   * @param exists whether a pin still points at something
   */
  prune: (exists: (pin: Pin) => boolean) => void;
}

export const usePins = create<PinsState>()(
  persist(
    (set, get) => ({
      pins: [],
      migrateTaskPins: (ids) =>
        set((state) => {
          const taskIds = new Set(ids);
          for (const pin of state.pins) {
            if (pin.kind === "task") taskIds.delete(pin.id);
          }
          const additions = Array.from(taskIds, (id): Pin => ({ id, kind: "task" }));
          return additions.length ? { pins: [...state.pins, ...additions] } : state;
        }),
      has: (pin) => get().pins.some((candidate) => pinKey(candidate) === pinKey(pin)),
      toggle: (pin) => {
        const key = pinKey(pin);
        const { pins } = get();
        set({
          pins: pins.some((candidate) => pinKey(candidate) === key)
            ? pins.filter((candidate) => pinKey(candidate) !== key)
            : [...pins, pin],
        });
      },
      move: (key, index) => {
        const { pins } = get();
        const pin = pins.find((candidate) => pinKey(candidate) === key);
        if (!pin) return;
        const rest = pins.filter((candidate) => pinKey(candidate) !== key);
        rest.splice(Math.max(0, Math.min(index, rest.length)), 0, pin);
        set({ pins: rest });
      },
      prune: (exists) => {
        const { pins } = get();
        const kept = pins.filter(exists);
        if (kept.length !== pins.length) set({ pins: kept });
      },
    }),
    { name: "wf-pins", version: 1 },
  ),
);

/**
 * Put a newly created space on the rail, so it is one click away.
 * @param id the space id
 */
export function pinNewSpace(id: string): void {
  const pin: Pin = { id, kind: "space" };
  if (!usePins.getState().has(pin)) usePins.getState().toggle(pin);
}
