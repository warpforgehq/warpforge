import type { LegendListRef } from "@legendapp/list/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { transcriptRestoreMode } from "@/lib/chatScroll";
import type { TranscriptListRow } from "@/lib/sessionStream";

import {
  CHAT_FOLLOW_REARM_PX,
  CHAT_LIST_FOOTER_HEIGHT,
  CHAT_MVCP_ANCHOR,
  GESTURE_WINDOW_MS,
} from "./constants";

export function useTranscriptFollow({
  active,
  taskId,
  disclosureSettling,
  disclosureAnchorKey,
}: {
  active: boolean;
  taskId: string;
  disclosureSettling: boolean;
  disclosureAnchorKey: React.RefObject<string | null>;
}) {
  const listRef = useRef<LegendListRef | null>(null);
  const previousScrollRef = useRef(0);
  const [following, setFollowing] = useState(true);
  // Mirrors for the scroll tracer: its listener outlives any one render, so it
  // needs the value at event time rather than the one captured at attach.
  const lastPointerRef = useRef(0);
  const followingRef = useRef(true);
  const disclosureSettlingRef = useRef(false);
  followingRef.current = following;
  disclosureSettlingRef.current = disclosureSettling;

  // Hoisted out of the JSX: a hook in a prop expression works only for as long
  // as nothing wraps that element in a condition, and breaks silently when
  // something does.
  const maintainVisibleContentPosition = useMemo(() => {
    const mode = transcriptRestoreMode(following, disclosureSettling, disclosureAnchorKey.current);
    if (mode === "none") return undefined;
    return {
      ...CHAT_MVCP_ANCHOR,
      shouldRestorePosition: (row: TranscriptListRow) =>
        mode === "anchor" ? row.id === disclosureAnchorKey.current : true,
    };
    // `disclosureSettling` flips when the anchor is set/cleared; the callback
    // reads `.current` directly, so these are the deps that stabilize it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disclosureSettling, following]);

  /**
   * Pin through the DOM node rather than `listRef.scrollToEnd()`. The
   * imperative method resolves an absolute target from per-type size
   * *estimates* and freezes those estimates for the duration of the scroll, so
   * in a long transcript it lands where the estimate claimed the end was —
   * possibly outside the follow zone, where nothing re-pins us. This is why
   * `maintainScrollAtEnd` scrolls the raw scroller instead.
   */
  const pinToLatest = useCallback(() => {
    const node = listRef.current?.getScrollableNode();
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    previousScrollRef.current = node.scrollTop;
  }, []);

  const onTranscriptScroll = useCallback(() => {
    const state = listRef.current?.getState();
    if (!state) return;
    const prev = previousScrollRef.current;
    previousScrollRef.current = state.scroll;
    const distanceFromEnd =
      state.contentLength - state.scroll - state.scrollLength - CHAT_LIST_FOOTER_HEIGHT;
    // A gesture away from the end wins over the re-arm band. Leaving the end
    // crosses that band on the way out — the trace shows six consecutive
    // events at `distanceFromEnd` between -51 and 15 — and re-arming on each
    // of them undid the gesture in the same tick it happened.
    const pullingAway = performance.now() - lastWheelUpRef.current < GESTURE_WINDOW_MS;
    if (!pullingAway && (state.isAtEnd || distanceFromEnd <= CHAT_FOLLOW_REARM_PX)) {
      setFollowing(true);
      return;
    }
    // Only a scroll the user actually drove detaches following. The list moves
    // the scroller downward on its own while rows measure — thousands of pixels
    // on a cold start — and reading that as "scrolled up" cancelled following
    // without a gesture, which turned one measurement burst into a chat stuck
    // far from the live edge. Wheel and touch cancel directly; this branch is
    // for the scrollbar drag, which produces no such event.
    const draggedRecently = performance.now() - lastPointerRef.current < GESTURE_WINDOW_MS;
    if (draggedRecently && state.scroll < prev - 1) setFollowing(false);
  }, []);

  const resumeLatest = useCallback(() => {
    setFollowing(true);
    pinToLatest();
  }, [pinToLatest]);

  // On a session switch (task.id change) while the transcript is the active
  // tab and the user is still following, re-pin to the live edge. Keyed on
  // `task.id` — not `transcriptRows` — so streaming deltas never re-enter
  // here to race maintainScrollAtEnd.
  useEffect(() => {
    if (!active || !following) return;
    const frame = requestAnimationFrame(pinToLatest);
    return () => cancelAnimationFrame(frame);
  }, [active, following, pinToLatest, taskId]);

  const cancelLiveFollow = useCallback(() => {
    setFollowing(false);
  }, []);

  /**
   * Detach on an upward gesture, as a React prop rather than a hand-attached
   * DOM listener.
   *
   * The listener version depended on `listRef` being populated inside a single
   * animation frame, and tracing showed it losing that race: across two full
   * sessions not one detach ever fired, so nothing could ever stop the list
   * pinning to the end. Props cannot lose that race — the element carrying
   * `onScroll` is the element carrying these.
   */
  const lastWheelUpRef = useRef(0);
  const onWheelCapture = useCallback(
    (event: React.WheelEvent) => {
      if (event.deltaY >= 0) return;
      lastWheelUpRef.current = performance.now();
      cancelLiveFollow();
    },
    [cancelLiveFollow],
  );
  const touchYRef = useRef<number | null>(null);
  const onTouchStartCapture = useCallback((event: React.TouchEvent) => {
    touchYRef.current = event.touches[0]?.clientY ?? null;
  }, []);
  const onTouchMoveCapture = useCallback(
    (event: React.TouchEvent) => {
      const nextY = event.touches[0]?.clientY;
      if (nextY === undefined) return;
      if (touchYRef.current !== null && nextY > touchYRef.current + 1) {
        lastWheelUpRef.current = performance.now();
        cancelLiveFollow();
      }
      touchYRef.current = nextY;
    },
    [cancelLiveFollow],
  );
  const pauseFollowingOnNavigationKey = useCallback(
    (event: React.KeyboardEvent) => {
      if (["ArrowUp", "Home", "PageUp"].includes(event.key)) cancelLiveFollow();
    },
    [cancelLiveFollow],
  );

  useEffect(() => {
    previousScrollRef.current = 0;
    let removeListeners: (() => void) | null = null;
    let frame = 0;
    let cancelled = false;
    let attempts = 0;
    /**
     * Wait for the list to hand us its scroller.
     *
     * `listRef` is populated after LegendList's own first commit, which on a
     * cold start lands *after* this effect's first animation frame. The
     * previous version asked once and returned — leaving the transcript with
     * no wheel/touch handlers and no keep-at-end observer for the entire
     * session. Nothing could then detach follow, so every scroll up was undone
     * by the list's own end-pinning, and the only cure was switching tasks and
     * back (which re-runs this effect against a ready ref). Confirmed by
     * tracing: not one detach or resize-pin event fired in a whole session.
     */
    const attach = () => {
      if (cancelled) return;
      const scrollNode = listRef.current?.getScrollableNode();
      if (!scrollNode) {
        attempts += 1;
        // ~2s at 60fps. If the scroller genuinely never appears, stop rather
        // than spin a frame callback for the life of the task.
        if (attempts > 120) return;
        frame = requestAnimationFrame(attach);
        return;
      }
      // Wheel and touch detach through React props on the list itself; only
      // the scrollbar-drag heuristic needs a raw listener, since a drag emits
      // no gesture event of its own.
      const onPointerDown = () => {
        lastPointerRef.current = performance.now();
      };
      scrollNode.addEventListener("pointerdown", onPointerDown, { passive: true });
      // The list sizes unmeasured rows from a running average, so a handful of
      // tall rows measuring can move the estimated total by tens of thousands
      // of pixels at once — past any sane end-pin band, which then lets go of
      // the end. Re-assert it here instead: a ResizeObserver runs before paint,
      // so the corrected position is the first one drawn and the growth is
      // never visible as a jump. This is deliberately on *size*, not on data —
      // the two imperative pins removed before fought `maintainScrollAtEnd`
      // over the same data change; this one covers the case it cannot.
      const keepAtEnd = new ResizeObserver(() => {
        if (!followingRef.current || disclosureSettlingRef.current) return;
        scrollNode.scrollTop = scrollNode.scrollHeight;
        previousScrollRef.current = scrollNode.scrollTop;
      });
      // Both boxes move the end. The content grows as rows measure; the
      // scroller itself grows when the composer collapses back to one line on
      // send — same distance from the end, different cause, and watching only
      // the content missed the second one entirely.
      keepAtEnd.observe(scrollNode);
      const content = scrollNode.firstElementChild;
      if (content) keepAtEnd.observe(content);
      removeListeners = () => {
        keepAtEnd?.disconnect();
        scrollNode.removeEventListener("pointerdown", onPointerDown);
      };
    };
    frame = requestAnimationFrame(attach);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      removeListeners?.();
    };
  }, [cancelLiveFollow, taskId]);

  return {
    listRef,
    following,
    maintainVisibleContentPosition,
    onTranscriptScroll,
    onWheelCapture,
    onTouchStartCapture,
    onTouchMoveCapture,
    pauseFollowingOnNavigationKey,
    resumeLatest,
  };
}
