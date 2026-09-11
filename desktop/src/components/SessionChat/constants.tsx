/**
 * How far beyond the viewport the list keeps rows rendered.
 *
 * This is not about scroll speed — it is the margin the window has to survive
 * a wrong size estimate. Unmeasured rows are sized by the average of their
 * type, and `agent_text` covers everything from a one-line acknowledgement to
 * a two-thousand-pixel answer, so its average badly overstates the short ones.
 * At 250 the list only had to cover ~1000px, which a single overestimated row
 * satisfied on its own: traced with a 511px viewport rendering exactly one row
 * (`start: 414, end: 414` of 494), leaving the rest of the screen blank. Four
 * viewports of margin means the window still holds several rows when the
 * estimate is off by a factor of three.
 */
export const CHAT_DRAW_DISTANCE_PX = 1000;
/**
 * Measured mean row height. Only mounted rows are measured, so this decides
 * almost the whole content height — and an estimate that is wrong in one
 * direction makes the height drift that way as rows do measure, dragging the
 * scroll with it. Sampled live: median 26, mean 66, max 591.
 */
export const CHAT_ESTIMATED_ROW_PX = 65;
export const CHAT_MAINTAIN_SCROLL_AT_END = {
  animated: false,
  on: { dataChange: true, itemLayout: true, layout: true },
} as const;
export const CHAT_FOLLOW_REARM_PX = 16;
/** How long a pointer press keeps counting as the cause of a scroll. */
export const GESTURE_WINDOW_MS = 300;
export const CHAT_LIST_FOOTER_HEIGHT = 56;
/** Anchor rows only while reading, never while following — see `docs/adr/0005`. */
export const CHAT_MVCP_ANCHOR = { data: true, size: true } as const;
/**
 * The list stops pinning once `distanceFromEnd > threshold * viewport`. One
 * agent message can add several viewports at once, which outruns a tight band
 * and leaves the pin disengaged while we still believe we are following —
 * measured at ~2000px adrift. `following` is the real authority for when to
 * stop, so this only has to be wider than any single burst.
 */
export const CHAT_MAINTAIN_SCROLL_AT_END_THRESHOLD = 3;
export const CHAT_LIST_HEADER = <div className="h-4" />;
export const CHAT_LIST_FOOTER = <div className="h-14" />;
export const CHAT_LIST_EMPTY = (
  <p className="px-2 py-4 text-muted-foreground">No session activity yet.</p>
);
