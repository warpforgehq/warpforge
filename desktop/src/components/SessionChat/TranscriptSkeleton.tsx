import { SkeletonBar, SkeletonBlock, skeletonWidth } from "@/components/ui/skeleton";

/**
 * The conversation before it arrives. The real transcript is bottom-anchored
 * (`initialScrollAtEnd` / `maintainScrollAtEnd` in `index.tsx`), so this is
 * bottom-aligned too: a skeleton that starts at the top would make the first
 * real message jump upward.
 *
 * Four blocks alternating agent → own message, in the transcript's own
 * `px-2 text-sm` measure. Agent blocks are full-width prose bars at a 20px
 * line box; own-message blocks are a right-inset bubble. Line counts are
 * fixed, and every width comes from `skeletonWidth`, so the shape is stable
 * across renders.
 */
const BLOCKS = [
  { id: "agent-1", role: "agent", lines: 3 },
  { id: "user-1", role: "user", lines: 2 },
  { id: "agent-2", role: "agent", lines: 4 },
  { id: "user-2", role: "user", lines: 2 },
] as const;

function lineWidth(block: number, line: number, count: number): number {
  return line === count - 1 ? 40 : skeletonWidth(block, line);
}

export function TranscriptSkeleton() {
  return (
    <SkeletonBlock
      role="status"
      aria-label="Loading conversation"
      data-testid="transcript-skeleton"
      className="flex h-full flex-col justify-end gap-4 overflow-hidden px-2 py-2 text-sm"
    >
      {BLOCKS.map((block, blockIndex) => {
        const lines = Array.from({ length: block.lines }, (_, lineIndex) => ({
          id: `${block.id}-${lineIndex}`,
          index: lineIndex,
        }));
        if (block.role === "user") {
          return (
            <div
              key={block.id}
              data-testid="transcript-skeleton-block"
              className="ml-auto flex w-[55%] flex-col gap-0.5 rounded-md bg-muted-foreground/10 px-3 py-2"
            >
              {lines.map((line) => (
                <div key={line.id} className="flex h-5 items-center">
                  <SkeletonBar
                    tone="primary"
                    w={lineWidth(blockIndex, line.index, block.lines)}
                    h={12}
                  />
                </div>
              ))}
            </div>
          );
        }
        return (
          <div
            key={block.id}
            data-testid="transcript-skeleton-block"
            className="flex w-full flex-col gap-0.5"
          >
            {lines.map((line) => (
              <div key={line.id} className="flex h-5 items-center">
                <SkeletonBar w={lineWidth(blockIndex, line.index, block.lines)} h={12} />
              </div>
            ))}
          </div>
        );
      })}
    </SkeletonBlock>
  );
}
