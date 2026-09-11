import { statusLabel } from "@/lib/statusMeta";

/**
 * What a row *is*. This is *not* `TaskStatus`: a task can be running while a
 * permission prompt blocks it, and snooze/settle are lifecycle overrides that
 * outrank whatever the task itself reports.
 *
 * The full vocabulary survives so tooltips, sorting and the row actions still
 * know the real state; what it no longer implies is a glyph (see `rowGlyph`).
 */
export type SidebarTaskState =
  | "needs_answer"
  | "review"
  | "blocked"
  | "failed"
  | "working"
  | "queued"
  | "idle"
  | "done"
  | "snoozed"
  | "settled";

/** Icon key; `SidebarTaskRow` maps it to a lucide component. */
export type SidebarStateIcon = SidebarTaskState;

export interface SidebarStateMeta {
  /** Word shown in the tooltip and to screen readers. */
  label: string;
  /**
   * Icon for the tooltip's state line. Every state keeps one — the tooltip is
   * an explicit, one-at-a-time request for detail, so it can afford to be
   * expressive where the list cannot.
   */
  icon: SidebarStateIcon;
  /**
   * Whether the *row* draws that icon. False for every resting state, which is
   * most of them: a finished task waiting on a human, an idle session and a
   * queued one are all "nothing to see", and decorating them is what made the
   * tree unreadable.
   */
  rowGlyph: boolean;
  /** Semantic token for the glyph. Colour is meaning, never decoration. */
  toneClass: string;
  /**
   * Title prominence. Three steps only: rows that want a human, rows that are
   * merely alive, and rows that are history.
   */
  titleClass: string;
  /** The agent is mid-turn, so the glyph animates. */
  live: boolean;
}

const ATTENTION_TITLE = "font-medium text-foreground";
const NORMAL_TITLE = "text-foreground/85";
const MUTED_TITLE = "text-muted-foreground/60";

/** Tooltip-only tone: a resting state must not tint the row it explains. */
const QUIET_TONE = "text-muted-foreground/70";

/**
 * Labels reuse `statusMeta` wherever a state maps 1:1 onto a `TaskStatus`, so
 * the sidebar can never disagree with the board or the task header. `review` is
 * the exception: it is derived from `filesChanged`, not reported, so it owns its
 * own word.
 *
 * Exactly four states set `rowGlyph`: an agent mid-turn (the green spinner),
 * and the three ways a task can actually want a human.
 */
export const SIDEBAR_STATE_META: Record<SidebarTaskState, SidebarStateMeta> = {
  blocked: {
    icon: "blocked",
    label: statusLabel("blocked"),
    live: false,
    rowGlyph: true,
    titleClass: ATTENTION_TITLE,
    toneClass: "text-warn",
  },
  done: {
    icon: "done",
    label: statusLabel("done"),
    live: false,
    rowGlyph: false,
    titleClass: MUTED_TITLE,
    toneClass: QUIET_TONE,
  },
  failed: {
    icon: "failed",
    label: statusLabel("interrupted"),
    live: false,
    rowGlyph: true,
    titleClass: ATTENTION_TITLE,
    toneClass: "text-destructive",
  },
  idle: {
    icon: "idle",
    label: statusLabel("waiting"),
    live: false,
    rowGlyph: false,
    titleClass: NORMAL_TITLE,
    toneClass: QUIET_TONE,
  },
  needs_answer: {
    icon: "needs_answer",
    label: "needs you",
    live: false,
    rowGlyph: true,
    titleClass: ATTENTION_TITLE,
    toneClass: "text-warn",
  },
  queued: {
    icon: "queued",
    label: statusLabel("queued"),
    live: false,
    rowGlyph: false,
    titleClass: NORMAL_TITLE,
    toneClass: QUIET_TONE,
  },
  // Resting, not pending: the agent finished and the diff is waiting whenever
  // the user gets to it. A glyph here fires on almost every row in the tree.
  review: {
    icon: "review",
    label: "needs review",
    live: false,
    rowGlyph: false,
    titleClass: NORMAL_TITLE,
    toneClass: QUIET_TONE,
  },
  settled: {
    icon: "settled",
    label: "handled",
    live: false,
    rowGlyph: false,
    titleClass: MUTED_TITLE,
    toneClass: QUIET_TONE,
  },
  // The wake countdown in the row's right lane is the whole story, so the row
  // needs no second marker for it.
  snoozed: {
    icon: "snoozed",
    label: "snoozed",
    live: false,
    rowGlyph: false,
    titleClass: MUTED_TITLE,
    toneClass: "text-info",
  },
  working: {
    icon: "working",
    label: statusLabel("running"),
    live: true,
    rowGlyph: true,
    titleClass: NORMAL_TITLE,
    toneClass: "text-ok",
  },
};
