/**
 * Keeps a scroll container pinned to an anchor while the layout around it
 * settles. CodeMirror merge rows measure themselves after mount, so a single
 * scroll lands mid-list: the row grows under the viewport and the file drifts
 * away from the top. This re-asserts the top alignment once per frame — with
 * instant `scrollTop` corrections, never a smooth animation that can be
 * interrupted — and stops as soon as the anchor holds still for two frames.
 *
 * The interfaces are structural rather than DOM types so the behaviour can be
 * tested without a browser: a fake anchor reports `top`, a fake container
 * takes `scrollTop`.
 */

export interface RectSource {
  getBoundingClientRect(): { top: number };
}

export interface ScrollTarget extends RectSource {
  scrollTop: number;
}

export interface FrameScheduler {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
}

/** ~1.5s at 60fps: long enough for a CodeMirror row to measure, short enough
 *  that a stale pin cannot fight the reader for long. */
const MAX_FRAMES = 90;
/** The anchor stopped moving: the row finished measuring. */
const STABLE_FRAMES = 2;
const EPSILON_PX = 1;

export function pinToTop({
  anchor,
  container,
  scheduler = { cancel: cancelAnimationFrame, request: requestAnimationFrame },
}: {
  anchor: () => RectSource | null;
  container: () => ScrollTarget | null;
  scheduler?: FrameScheduler;
}): () => void {
  let frames = 0;
  let stable = 0;
  let handle = 0;
  let stopped = false;

  const step = () => {
    if (stopped) return;
    const target = container();
    const source = anchor();
    if (!target || !source) {
      schedule();
      return;
    }
    const drift = source.getBoundingClientRect().top - target.getBoundingClientRect().top;
    if (Math.abs(drift) > EPSILON_PX) {
      target.scrollTop += drift;
      stable = 0;
    } else {
      stable += 1;
      if (stable >= STABLE_FRAMES) return;
    }
    schedule();
  };

  const schedule = () => {
    if (frames >= MAX_FRAMES) return;
    frames += 1;
    handle = scheduler.request(step);
  };

  schedule();

  return () => {
    stopped = true;
    scheduler.cancel(handle);
  };
}
