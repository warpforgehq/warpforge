import { describe, expect, it } from "vitest";

import { pinToTop, type FrameScheduler, type RectSource, type ScrollTarget } from "./pinToTop";

function anchorAt(absoluteTop: () => number, container: () => ScrollTarget): RectSource {
  return {
    getBoundingClientRect: () => ({ top: absoluteTop() - container().scrollTop }),
  };
}

function containerAt(top = 0): ScrollTarget {
  let scrollTop = 0;
  return {
    getBoundingClientRect: () => ({ top }),
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = value;
    },
  };
}

/** Runs queued frames on demand so the loop is deterministic in tests. */
function manualScheduler() {
  const queue = new Map<number, () => void>();
  let next = 1;
  const scheduler: FrameScheduler = {
    cancel: (handle) => {
      queue.delete(handle);
    },
    request: (callback) => {
      const handle = next++;
      queue.set(handle, callback);
      return handle;
    },
  };
  const runFrame = () => {
    const pending = [...queue.entries()];
    queue.clear();
    for (const [, callback] of pending) callback();
    return pending.length;
  };
  return { runFrame, scheduler };
}

describe("pinToTop", () => {
  it("keeps the anchor at the top while the row grows, then settles", () => {
    const { runFrame, scheduler } = manualScheduler();
    let rowTop = 400;
    const container = containerAt();
    const anchor = anchorAt(() => rowTop, () => container);

    pinToTop({ anchor: () => anchor, container: () => container, scheduler });

    // The row sits 400px down the list: the container scrolls onto it.
    expect(runFrame()).toBe(1);
    expect(container.scrollTop).toBe(400);

    // The row measures itself and moves: a smooth scroll would have drifted
    // here, the pin corrects instantly.
    rowTop = 40;
    runFrame();
    expect(container.scrollTop).toBe(40);

    // Aligned: two quiet frames end the loop.
    expect(runFrame()).toBe(1);
    expect(runFrame()).toBe(1);
    expect(runFrame()).toBe(0);
  });

  it("waits for the anchor to exist instead of giving up", () => {
    const { runFrame, scheduler } = manualScheduler();
    const container = containerAt();
    let rowTop: number | null = null;

    pinToTop({
      anchor: () => {
        if (rowTop === null) return null;
        const top = rowTop;
        return anchorAt(() => top, () => container);
      },
      container: () => container,
      scheduler,
    });

    runFrame();
    expect(container.scrollTop).toBe(0);

    rowTop = 120;
    runFrame();
    expect(container.scrollTop).toBe(120);
  });

  it("stops when cancelled, so a newer request owns the scroll", () => {
    const { runFrame, scheduler } = manualScheduler();
    const container = containerAt();
    const cancel = pinToTop({
      anchor: () => anchorAt(() => 200, () => container),
      container: () => container,
      scheduler,
    });

    cancel();
    runFrame();
    expect(container.scrollTop).toBe(0);
  });

  it("is bounded: a layout that never settles cannot spin forever", () => {
    const { runFrame, scheduler } = manualScheduler();
    let rowTop = 0;
    const container = containerAt();

    pinToTop({
      anchor: () => anchorAt(() => (rowTop += 10), () => container),
      container: () => container,
      scheduler,
    });

    let frames = 0;
    while (runFrame() > 0) frames += 1;
    expect(frames).toBeLessThanOrEqual(90);
  });
});
