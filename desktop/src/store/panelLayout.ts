import { useCallback, useLayoutEffect, useRef } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Geometry for the drag-resizable rails. Each rail owns a key with its own
 * resting width and drag bounds, so [min, max] lives next to the default that
 * a double-click reset returns to instead of being spread across call sites.
 */
export interface PanelBounds {
  default: number;
  min: number;
  max: number;
}

export const PANEL_BOUNDS = {
  files: { default: 300, min: 200, max: 560 },
  diff: { default: 300, min: 220, max: 560 },
  runtime: { default: 288, min: 220, max: 520 },
  pipeline: { default: 256, min: 200, max: 460 },
  inboxList: { default: 340, min: 240, max: 560 },
  pullFiles: { default: 264, min: 200, max: 480 },
  pullMeta: { default: 288, min: 240, max: 460 },
} as const satisfies Record<string, PanelBounds>;

export type PanelKey = keyof typeof PANEL_BOUNDS;

export function clampPanelSize(key: PanelKey, value: number): number {
  const { default: fallback, min, max } = PANEL_BOUNDS[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

interface PanelLayoutState {
  /** Persisted widths (px) for the drag-resizable rails, keyed by panel id. */
  panelSizes: Partial<Record<PanelKey, number>>;
  setPanelSize: (key: PanelKey, width: number) => void;
  /** The conversation sits to the right of the workspace when true. */
  chatOnRight: boolean;
  toggleChatOnRight: () => void;
}

export const usePanelLayout = create<PanelLayoutState>()(
  persist(
    (set) => ({
      panelSizes: {},
      setPanelSize: (key, width) =>
        set((state) => ({
          panelSizes: { ...state.panelSizes, [key]: clampPanelSize(key, width) },
        })),
      chatOnRight: false,
      toggleChatOnRight: () => set((state) => ({ chatOnRight: !state.chatOnRight })),
    }),
    { name: "wf-panels", version: 1 },
  ),
);

/** Width of one rail, clamped to its bounds, plus a setter that re-clamps. */
export function usePanelSize(key: PanelKey): [number, (width: number) => void] {
  const stored = usePanelLayout((s) => s.panelSizes[key]);
  const setPanelSize = usePanelLayout((s) => s.setPanelSize);
  const size = stored ?? PANEL_BOUNDS[key].default;
  const setSize = useCallback((width: number) => setPanelSize(key, width), [key, setPanelSize]);
  return [size, setSize];
}

/** Room a surface has to keep beside its rail before the rail is in the way. */
const RAIL_CONTENT_MIN = 320;

/**
 * Folds a rail away on its own once the surface around it is too narrow to
 * show both the rail and anything worth reading beside it — squeezing the
 * workspace side of a split otherwise ends at a screen that is all rail.
 *
 * Crossing the threshold sets the rail's own collapsed flag rather than
 * overriding it, so the header toggle keeps working: this picks the default
 * for a width, and the user can still open the rail back up at that width.
 *
 * @param railWidth Current width of the rail, in pixels.
 * @param setCollapsed Writes the rail's collapsed flag.
 * @returns A ref to put on the surface element.
 */
export function useAutoHiddenRail(railWidth: number, setCollapsed: (collapsed: boolean) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const narrowRef = useRef<boolean | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const watch = new ResizeObserver(([entry]) => {
      const narrow = entry.contentRect.width < railWidth + RAIL_CONTENT_MIN;
      if (narrowRef.current === narrow) return;
      const measuring = narrowRef.current === null;
      narrowRef.current = narrow;
      // A first measurement that finds room says nothing — the rail was never
      // in the way, so the stored choice stands.
      if (!measuring || narrow) setCollapsed(narrow);
    });
    watch.observe(element);
    return () => watch.disconnect();
  }, [railWidth, setCollapsed]);
  return ref;
}
