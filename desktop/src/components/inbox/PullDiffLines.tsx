import { Plus } from "lucide-react";
import * as React from "react";

import { pairHunkLines, type PatchHunk, type PatchLine } from "@/lib/pullDiff";
import type { PatchHighlight, SyntaxToken } from "@/lib/pullDiffHighlight";
import { cn } from "@/lib/utils";

const LINE_CLASS: Record<string, string> = {
  add: "bg-ok/10 text-foreground/90",
  del: "bg-destructive/10 text-foreground/80",
  context: "text-foreground/70",
  meta: "text-muted-foreground/50 italic",
};

const GUTTER_CLASS: Record<string, string> = {
  add: "text-ok/80",
  del: "text-destructive/70",
  context: "text-muted-foreground/40",
  meta: "text-muted-foreground/30",
};

/**
 * What a gutter interaction means.
 *
 * `start` begins a span and holds it open while the button is down, `hover` is
 * the pointer passing over a line (only the owner of the drag knows whether
 * that should grow the span, so it decides), `commit` is the release that
 * finally asks for the composer, and `extend` grows the span and commits in
 * one go — shift-clicking a line reached by scrolling.
 */
export type CommentIntent = "start" | "hover" | "commit" | "extend";

/** Which side of the diff a comment on this line belongs to. */
export function lineSide(line: PatchLine): "LEFT" | "RIGHT" {
  return line.kind === "del" ? "LEFT" : "RIGHT";
}

/** The line number a comment on this line is addressed to. */
export function lineNumberFor(line: PatchLine): number | undefined {
  return line.kind === "del" ? line.oldNumber : line.newNumber;
}

export interface PullDiffLinesProps {
  hunk: PatchHunk;
  mode: "unified" | "split";
  /** Tokens per line id; absent ids render plain. */
  tokens?: PatchHighlight;
  /** Opens or grows a comment's span. Omitted where commenting is not offered. */
  onComment?: (line: PatchLine, intent: CommentIntent) => void;
  /** Comment threads and composers to render under a line. */
  lineExtras?: (line: PatchLine) => React.ReactNode;
  /** The lines a comment being written covers, so they read as selected. */
  range?: LineRange;
}

/** A comment's span on one side of the diff, in that side's own numbering. */
export interface LineRange {
  side: "LEFT" | "RIGHT";
  start: number;
  end: number;
}

/**
 * Whether *this column's* number falls in the span.
 *
 * The column, not the line: a context line is one object rendered in both
 * halves of a split row, so asking which side the line belongs to lit up the
 * left half of every selected context row.
 */
export function columnInRange(
  column: "LEFT" | "RIGHT",
  number: number | undefined,
  range?: LineRange,
): boolean {
  if (!range || column !== range.side || number === undefined) return false;
  return number >= range.start && number <= range.end;
}

/** The span reads off the ruler alone. Tinting whole lines fought the add/del
 *  colours the diff already uses to mean something. */
const SELECTED_GUTTER = "bg-primary/20 text-primary";

/**
 * One hunk's lines, unified or side by side. Both layouts read from the same
 * parsed patch — the split view is a pairing of the lines we already have
 * (`lib/pullDiff`), not a second fetch of both file revisions.
 */
export function PullDiffLines({
  hunk,
  mode,
  tokens,
  onComment,
  lineExtras,
  range,
}: PullDiffLinesProps) {
  const header = (
    <div className="sticky left-0 border-y border-border/40 bg-secondary/20 px-2.5 text-muted-foreground/70">
      {hunk.header}
    </div>
  );

  if (mode === "split") {
    return (
      <>
        {header}
        {pairHunkLines(hunk.lines).map((row) => {
          const meta = row.left?.kind === "meta" ? row.left : null;
          if (meta) {
            return (
              <div key={row.id} className={cn("px-2.5", LINE_CLASS.meta)}>
                {meta.text}
              </div>
            );
          }
          // A comment belongs to the changed line, and the right side is the
          // one that still exists unless the row is a pure deletion.
          const anchor = row.right ?? row.left;
          return (
            <React.Fragment key={row.id}>
              <div className="flex min-w-0">
                <SplitHalf
                  side="LEFT"
                  line={row.left}
                  number={row.left?.oldNumber}
                  tokens={row.left ? tokens?.get(row.left.id) : undefined}
                  onComment={onComment}
                  range={range}
                />
                <SplitHalf
                  side="RIGHT"
                  line={row.right}
                  number={row.right?.newNumber}
                  tokens={row.right ? tokens?.get(row.right.id) : undefined}
                  onComment={onComment}
                  range={range}
                  bordered
                />
              </div>
              {anchor ? lineExtras?.(anchor) : null}
            </React.Fragment>
          );
        })}
      </>
    );
  }

  return (
    <>
      {header}
      {hunk.lines.map((line) => (
        <React.Fragment key={line.id}>
          <div className={cn("group/line flex", LINE_CLASS[line.kind])}>
            <Gutter
              side="LEFT"
              line={line}
              number={line.oldNumber}
              onComment={onComment}
              selected={columnInRange("LEFT", line.oldNumber, range)}
            />
            <Gutter
              side="RIGHT"
              line={line}
              number={line.newNumber}
              onComment={onComment}
              selected={columnInRange("RIGHT", line.newNumber, range)}
            />
            <span className="w-3 shrink-0 select-none text-muted-foreground/40">
              {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
            </span>
            <span className="whitespace-pre-wrap break-all pr-2.5">
              <LineText line={line} tokens={tokens?.get(line.id)} />
            </span>
          </div>
          {lineExtras?.(line)}
        </React.Fragment>
      ))}
    </>
  );
}

/** One side of a split row: number gutter, then the text. */
function SplitHalf({
  side,
  line,
  number,
  tokens,
  onComment,
  bordered,
  range,
}: {
  side: "LEFT" | "RIGHT";
  line: PatchLine | null;
  number?: number;
  tokens?: SyntaxToken[];
  onComment?: (line: PatchLine, intent: CommentIntent) => void;
  bordered?: boolean;
  range?: LineRange;
}) {
  return (
    <div
      className={cn(
        "group/line flex w-1/2 min-w-0",
        bordered && "border-l border-border/40",
        line ? LINE_CLASS[line.kind] : "bg-secondary/10",
      )}
    >
      {line ? (
        <>
          <Gutter
            side={side}
            line={line}
            number={number}
            onComment={onComment}
            selected={columnInRange(side, number, range)}
          />
          <span className="min-w-0 whitespace-pre-wrap break-all pr-2.5">
            <LineText line={line} tokens={tokens} />
          </span>
        </>
      ) : (
        <span className="w-10 shrink-0" />
      )}
    </div>
  );
}

/**
 * A line-number cell. Where commenting is offered the number swaps for a
 * "comment" button on row hover — the affordance every review tool puts
 * there, and it costs no layout because it replaces the number in place.
 */
function Gutter({
  side,
  line,
  number,
  onComment,
  selected,
}: {
  /** Which image this column numbers — not which side the line belongs to. */
  side: "LEFT" | "RIGHT";
  line: PatchLine;
  number?: number;
  onComment?: (line: PatchLine, intent: CommentIntent) => void;
  selected?: boolean;
}) {
  // Exactly one gutter of a row owns the comment affordance: the column whose
  // image the comment would be addressed to. Comparing line numbers instead
  // put the button in both columns of a context line, where the pre- and
  // post-image numbers are usually the same.
  const commentable =
    !!onComment && line.kind !== "meta" && number !== undefined && side === lineSide(line);
  return (
    <span
      // The whole number column, not just the 16px button, answers the drag:
      // pulling straight down a gutter must not depend on staying inside a
      // button that is only there while its own row is hovered.
      onPointerEnter={commentable ? () => onComment?.(line, "hover") : undefined}
      className={cn(
        "tnum relative w-10 shrink-0 select-none pr-1.5 text-right",
        GUTTER_CLASS[line.kind],
        selected && SELECTED_GUTTER,
      )}
    >
      {/* Pinned to the first visual line, not centred in the cell: a long line
          wraps, which makes the row taller than one line while its number
          stays on top — centring put the button halfway down the wrap. `h-5`
          is the diff's own `leading-5`, and `right-1.5` the digits' right
          padding, so the button lands exactly where the number sat. */}
      {commentable && (
        <button
          type="button"
          aria-label={
            lineSide(line) === "LEFT"
              ? `Comment on removed line ${number}`
              : `Comment on line ${number}`
          }
          title="Comment on this line — drag or shift-click to cover a range"
          // Pointer-down, not click: the press starts a drag that may grow the
          // span, and a click firing afterwards would collapse it back to one
          // line. `preventDefault` keeps the drag from selecting the diff text.
          onPointerDown={(event) => {
            event.preventDefault();
            onComment?.(line, event.shiftKey ? "extend" : "start");
          }}
          // The composer waits for the release: while the button is held the
          // gesture is still choosing lines, and a box popping up under the
          // cursor mid-drag is what "held it and it opened anyway" looked like.
          onPointerUp={() => onComment?.(line, "commit")}
          // Buttons are reachable by keyboard, and that path has no pointer.
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            // No pointer to release, so this both starts and commits.
            onComment?.(line, event.shiftKey ? "extend" : "start");
            if (!event.shiftKey) onComment?.(line, "commit");
          }}
          className="absolute right-1.5 top-0 hidden h-5 w-4 items-center justify-center rounded-[3px] bg-primary text-primary-foreground group-hover/line:flex hover:bg-primary/85"
        >
          <Plus className="size-3" strokeWidth={2.5} />
        </button>
      )}
      <span className={cn("block h-5", commentable && "group-hover/line:invisible")}>
        {number ?? ""}
      </span>
    </span>
  );
}

function LineText({ line, tokens }: { line: PatchLine; tokens?: SyntaxToken[] }) {
  if (!tokens || tokens.length === 0) {
    return <>{line.text || (line.kind === "context" ? " " : "")}</>;
  }
  // Keyed by the token's offset in the line: data-dependent, and stable while
  // the line is what it is.
  let offset = 0;
  return (
    <>
      {tokens.map((token) => {
        const key = `${offset}`;
        offset += token.text.length;
        return token.className ? (
          <span key={key} className={token.className}>
            {token.text}
          </span>
        ) : (
          <React.Fragment key={key}>{token.text}</React.Fragment>
        );
      })}
    </>
  );
}
