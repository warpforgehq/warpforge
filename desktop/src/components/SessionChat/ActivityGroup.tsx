import { ChevronRight } from "lucide-react";
import { memo, useContext, useLayoutEffect, useRef } from "react";

import { SKELETON_PULSE } from "@/components/ui/skeleton";
import type { TranscriptListRow } from "@/lib/sessionStream";
import { dominantCategory, type ActivityItem } from "@/lib/transcriptGroups";
import { cn } from "@/lib/utils";

import { ActivityGroupRow } from "./ActivityGroupRow";
import { CategoryIcon } from "./ActivityIcons";
import { CHAT_LIVE_GROUP_MAX_STEPS } from "./constants";
import { TranscriptRowContext, type TranscriptRowContextValue } from "./TranscriptRow";

type ActivityRow = Extract<TranscriptListRow, { kind: "activity" }>;

function useTranscriptContext(): TranscriptRowContextValue {
  const shared = useContext(TranscriptRowContext);
  if (!shared) throw new Error("Activity group rendered outside its context");
  return shared;
}

/**
 * The steps a live group has already finished. A streamed chunk rebuilds every
 * `ActivityItem` wrapper, so without this the group's whole element list is
 * reconciled on each token — nine hundred settled steps cost nine dropped
 * frames. The prefix only re-renders when one of its updates actually changes.
 */
const SettledSteps = memo(
  function SettledSteps({ items, live }: { items: ActivityItem[]; live: boolean }) {
    return (
      <>
        {items.map((item) => (
          <div key={item.key} className="activity-rail-step">
            <ActivityGroupRow item={item} bare live={live} />
          </div>
        ))}
      </>
    );
  },
  (previous, next) =>
    previous.live === next.live &&
    previous.items.length === next.items.length &&
    previous.items.every(
      (item, index) =>
        item.key === next.items[index].key && item.entry.update === next.items[index].entry.update,
    ),
);

/**
 * Keep a live group's body on its newest step. Pin runs in layout before paint
 * so the window follows without a visible hitch; a wheel away from the bottom
 * pauses it until the reader returns.
 */
function useLiveRail(
  ref: React.RefObject<HTMLDivElement | null>,
  items: ActivityRow["items"],
  enabled: boolean,
) {
  const stick = useRef(true);
  const wasEnabled = useRef(false);

  useLayoutEffect(() => {
    if (!enabled) {
      wasEnabled.current = false;
      return;
    }
    if (!wasEnabled.current) {
      stick.current = true;
      wasEnabled.current = true;
    }
    const node = ref.current;
    if (node && stick.current) node.scrollTop = node.scrollHeight;
  }, [enabled, items, ref]);

  return () => {
    const node = ref.current;
    if (node && node.scrollHeight - node.scrollTop - node.clientHeight <= 8) stick.current = true;
  };
}

function HeaderDiffstat({
  clip,
}: {
  clip: Extract<ActivityRow["summary"]["clips"][number], { kind: "edit" }>;
}) {
  const shared = useTranscriptContext();
  const path = clip.path ? shared.resolveFilePath(clip.path) : null;
  const body = (
    <>
      <span className="text-ok">+{clip.additions}</span>
      <span className="text-destructive">−{clip.deletions}</span>
    </>
  );
  const className =
    "inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[12px] tabular-nums";
  const label = `${clip.additions} lines added, ${clip.deletions} lines deleted`;
  if (!path) {
    return (
      <span className={cn(className, "relative z-10")} aria-label={label}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      title="Open diff"
      onClick={(event) => {
        event.stopPropagation();
        shared.onOpenFileDiff(path);
      }}
      className={cn(className, "relative z-10", "hover:bg-accent/40")}
    >
      {body}
    </button>
  );
}

export const ActivityGroup = memo(function ActivityGroup({ row }: { row: ActivityRow }) {
  const shared = useTranscriptContext();
  const railRef = useRef<HTMLDivElement | null>(null);
  const onRailScroll = useLiveRail(railRef, row.items, row.open && row.live);
  const editClip = row.summary.clips.find(
    (clip): clip is Extract<ActivityRow["summary"]["clips"][number], { kind: "edit" }> =>
      clip.kind === "edit",
  );

  // A lone step the agent never introduced is not a group: a header repeating
  // the single row under it says the same thing twice. The category icon stays
  // inside the row so the hover fill and hit area cover it too.
  if (!row.expandable) {
    return (
      <div className="min-w-0">
        <ActivityGroupRow item={row.items[0]} bare={false} live={row.live} />
      </div>
    );
  }

  const hiddenSteps = row.live ? Math.max(0, row.items.length - CHAT_LIVE_GROUP_MAX_STEPS) : 0;
  const visibleItems = hiddenSteps > 0 ? row.items.slice(hiddenSteps) : row.items;

  return (
    <div className="flex min-w-0 flex-col">
      <div
        className="group relative flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-accent/40"
        onClick={() => shared.onToggleWorkGroup(row.groupId, !row.open)}
      >
        <button
          type="button"
          aria-expanded={row.open}
          aria-label={row.open ? "Hide the work" : "Show the work"}
          className="absolute inset-0 cursor-pointer rounded focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        />
        <span className="relative flex size-3.5 shrink-0 items-center justify-center">
          <CategoryIcon
            category={dominantCategory(row.items)}
            className={cn("transition-opacity duration-200", row.open && "opacity-0")}
          />
          <ChevronRight
            className={cn(
              "absolute size-3.5 text-muted-foreground opacity-0 transition-[transform,opacity] duration-200 group-hover:opacity-100 group-focus-within:opacity-100",
              row.open && "rotate-90 opacity-100",
            )}
            strokeWidth={1.75}
          />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-sans text-sm text-muted-foreground transition-colors duration-200 group-hover:text-foreground/80",
            row.live && SKELETON_PULSE,
            row.hasFailure && "text-destructive",
          )}
        >
          {row.summary.text}
        </span>
        {editClip ? <HeaderDiffstat clip={editClip} /> : null}
      </div>
      {row.open ? (
        <div
          ref={railRef}
          onScroll={onRailScroll}
          className={cn("activity-rail pb-1", row.live && "activity-rail-live")}
        >
          {hiddenSteps > 0 ? (
            <div className="activity-rail-step">
              <div className="px-2 py-1 text-[12px] text-muted-foreground">
                {hiddenSteps} earlier {hiddenSteps === 1 ? "step" : "steps"}
              </div>
            </div>
          ) : null}
          <SettledSteps items={visibleItems.slice(0, -1)} live={row.live} />
          <div className="activity-rail-step">
            <ActivityGroupRow item={visibleItems[visibleItems.length - 1]} bare live={row.live} />
          </div>
        </div>
      ) : null}
    </div>
  );
});
