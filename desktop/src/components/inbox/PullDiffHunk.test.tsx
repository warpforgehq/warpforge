import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseUnifiedPatch } from "@/lib/pullDiff";

import { PullDiffHunk, ROW_HEIGHT_PX } from "./PullDiffHunk";

/** The observers `lib/nearViewport` stood up, newest last. */
const observers: FakeObserver[] = [];

class FakeObserver {
  targets = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  emit(isIntersecting: boolean) {
    const entries = [...this.targets].map(
      (target) => ({ isIntersecting, target }) as IntersectionObserverEntry,
    );
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

const LINES = 6;

function hunkOf(lines: number) {
  const rows = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    `@@ -1,${lines} +1,${lines} @@`,
  ];
  for (let n = 0; n < lines; n += 1) rows.push(`+  const v${n} = ${n};`);
  return parseUnifiedPatch(rows.join("\n"))[0].hunks[0];
}

/** `lib/nearViewport` keeps one observer for the whole app, so it is stood up
 *  once for this file and every test drives that one. */
function watcher(): FakeObserver {
  const observer = observers[0];
  if (!observer) throw new Error("nothing observed the hunk");
  return observer;
}

describe("PullDiffHunk", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", FakeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stands in as a spacer of the estimated height until it comes near", () => {
    const { container } = render(<PullDiffHunk hunk={hunkOf(LINES)} mode="unified" />);

    expect(screen.queryByText(/const v0/)).toBeNull();
    expect((container.firstElementChild as HTMLElement).style.height).toBe(
      `${LINES * ROW_HEIGHT_PX}px`,
    );
  });

  it("mounts its rows on approach and lets them go again", () => {
    render(<PullDiffHunk hunk={hunkOf(LINES)} mode="unified" />);
    const observer = watcher();

    act(() => observer.emit(true));
    expect(screen.getByText(/const v0/)).toBeTruthy();

    // Scrolled well past: the rows go, and with them their ~27 DOM elements
    // apiece — the whole point of the spacer.
    act(() => observer.emit(false));
    expect(screen.queryByText(/const v0/)).toBeNull();
  });

  it("keeps a pinned hunk mounted however far it scrolls", () => {
    render(<PullDiffHunk hunk={hunkOf(LINES)} mode="unified" pinned />);
    const observer = watcher();

    act(() => observer.emit(false));
    // A composer's typed text lives in this DOM; dropping it would lose what
    // the reviewer wrote.
    expect(screen.getByText(/const v0/)).toBeTruthy();
  });
});
