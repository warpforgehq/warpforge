import {
  SkeletonBar,
  SkeletonBlock,
  SKELETON_LINE_BAR_PX,
  skeletonWidth,
} from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The conversation before it arrives. The real transcript is bottom-anchored
 * (`initialScrollAtEnd` / `maintainScrollAtEnd` in `index.tsx`), so this is
 * bottom-aligned too: a skeleton that starts at the top would make the first
 * real message jump upward.
 *
 * Every block mirrors what `TranscriptList` lays out for its kind — an own
 * message is the right-inset tinted card `StreamLine` draws at `max-w-[90%]`,
 * agent text is full-measure prose at the chat's 24px line box, and a work
 * group is a stack of 24px steps — so the transcript reads as a conversation
 * arriving rather than as stacked grey. Line counts and widths are fixed.
 */

/** Chat prose: `text-sm` at the typeset chat leading of 1.75. */
const LINE_PX = 24;

const BLOCKS = [
  { id: "user-1", kind: "user", paragraphs: [2] },
  { id: "agent-1", kind: "agent", paragraphs: [3] },
  { id: "work-1", kind: "work", steps: 3 },
  { id: "user-2", kind: "user", paragraphs: [1] },
  { id: "agent-2", kind: "agent", paragraphs: [4, 2] },
] as const;

/** A paragraph ends short of the measure, or the block reads as a table. */
function lineWidth(seed: number, line: number, count: number, min: number, max: number): number {
  return line === count - 1 ? min + 8 : skeletonWidth(seed, line, min, max);
}

function Paragraph({
  seed,
  lines,
  min,
  max,
  tone,
  className,
}: {
  seed: number;
  lines: number;
  min: number;
  max: number;
  tone?: "primary" | "muted";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {Array.from({ length: lines }, (_, line) => (
        <span key={line} className="flex items-center" style={{ height: LINE_PX }}>
          <SkeletonBar
            h={SKELETON_LINE_BAR_PX}
            w={lineWidth(seed, line, lines, min, max)}
            tone={tone}
          />
        </span>
      ))}
    </div>
  );
}

export function TranscriptSkeleton() {
  return (
    <SkeletonBlock
      role="status"
      aria-label="Loading conversation"
      data-testid="transcript-skeleton"
      className="flex h-full flex-col justify-end overflow-hidden px-2 pb-14 text-sm"
    >
      {BLOCKS.map((block, index) => {
        if (block.kind === "work") {
          return (
            <div
              key={block.id}
              data-testid="transcript-skeleton-block"
              data-kind="work"
              className="mx-auto w-full min-w-0 pb-3"
            >
              {Array.from({ length: block.steps }, (_, step) => (
                <div
                  key={step}
                  className="flex items-center gap-1.5 rounded px-2"
                  style={{ height: LINE_PX }}
                >
                  <SkeletonBar className="size-3.5 shrink-0" />
                  <SkeletonBar h={SKELETON_LINE_BAR_PX} w={skeletonWidth(index, step, 25, 55)} />
                </div>
              ))}
            </div>
          );
        }

        if (block.kind === "user") {
          return (
            <div
              key={block.id}
              data-testid="transcript-skeleton-block"
              data-kind="user"
              className="ml-auto w-full min-w-0 max-w-[90%] pb-3"
            >
              <div className="rounded-md border border-primary/20 bg-primary/10 px-3.5 py-2.5 my-3">
                <Paragraph
                  seed={index}
                  lines={block.paragraphs[0]}
                  min={55}
                  max={95}
                  tone="primary"
                />
              </div>
            </div>
          );
        }

        return (
          <div
            key={block.id}
            data-testid="transcript-skeleton-block"
            data-kind="agent"
            className="mx-auto w-full min-w-0 pb-3"
          >
            {Array.from({ length: block.paragraphs.length }, (_, paragraph) => (
              <Paragraph
                key={paragraph}
                seed={index + paragraph}
                lines={block.paragraphs[paragraph]}
                min={38}
                max={95}
                className={paragraph > 0 ? "mt-3" : undefined}
              />
            ))}
          </div>
        );
      })}
    </SkeletonBlock>
  );
}
