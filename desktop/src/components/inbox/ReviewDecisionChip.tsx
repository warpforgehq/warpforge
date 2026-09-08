import { CircleCheck, CircleDot, CircleX, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A pull request's review decision, read as one chip. Glyph first, colour
 * second — the same rule the backlog's status chips follow, so it survives
 * colour blindness and the muted themes alike.
 */
export const REVIEW_DECISION_META: Record<
  string,
  { label: string; className: string; glyphClassName: string; icon: LucideIcon }
> = {
  APPROVED: {
    className: "border-ok/40 bg-ok/10 text-ok",
    glyphClassName: "text-ok",
    icon: CircleCheck,
    label: "Approved",
  },
  CHANGES_REQUESTED: {
    className: "border-destructive/40 bg-destructive/10 text-destructive",
    glyphClassName: "text-destructive",
    icon: CircleX,
    label: "Changes requested",
  },
  REVIEW_REQUIRED: {
    className: "border-warn/40 bg-warn/10 text-warn",
    // Awaiting review is the one state that wants a second look, so it gets
    // the warning colour — the muted grey read as "no decision" and vanished
    // into the row.
    glyphClassName: "text-warn",
    icon: CircleDot,
    label: "Review required",
  },
};

export function reviewDecisionMeta(decision?: string | null) {
  if (!decision) return null;
  return REVIEW_DECISION_META[decision.trim().toUpperCase()] ?? null;
}

export function ReviewDecisionChip({
  decision,
  className,
}: {
  decision?: string | null;
  className?: string;
}) {
  const meta = reviewDecisionMeta(decision);
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-px text-xs",
        meta.className,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{meta.label}</span>
    </span>
  );
}

/**
 * The same decision as one glyph, for the list rail.
 *
 * A 320px row cannot spend two thirds of a line on the words "Review
 * required" — but the decision is exactly what you scan a list for, so it
 * keeps its colour and its shape and drops only the label, which the title
 * attribute still carries.
 */
export function ReviewDecisionGlyph({
  decision,
  className,
}: {
  decision?: string | null;
  className?: string;
}) {
  const meta = reviewDecisionMeta(decision);
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span title={meta.label} className="inline-flex shrink-0">
      <Icon
        aria-label={meta.label}
        className={cn("size-3.5 shrink-0", meta.glyphClassName, className)}
      />
    </span>
  );
}
