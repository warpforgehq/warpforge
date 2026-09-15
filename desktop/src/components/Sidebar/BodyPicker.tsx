import { useCallback, useRef } from "react";

import { cn } from "@/lib/utils";

import { SEGMENTS, type SidebarSegment } from "./segments";

/** The body the segments address, for `aria-controls`. */
export const SIDEBAR_BODY_ID = "sidebar-body";

export const segmentTabId = (segment: SidebarSegment) => `sidebar-segment-${segment}`;

/**
 * Picks what the sidebar body shows. It owns the body and nothing else —
 * Mission Control and Automations stay nav rows underneath, so a new
 * destination costs a row rather than a tab.
 */
export function BodyPicker({
  segment,
  inboxCount,
  onSelect,
}: {
  segment: SidebarSegment;
  /** Unread pull requests; the badge the Inbox nav row used to carry. */
  inboxCount: number;
  onSelect: (segment: SidebarSegment) => void;
}) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = useCallback(
    (from: number, direction: 1 | -1) => {
      const index = (from + direction + SEGMENTS.length) % SEGMENTS.length;
      const next = SEGMENTS[index];
      if (!next) return;
      tabs.current[index]?.focus();
      onSelect(next.id);
    },
    [onSelect],
  );

  return (
    <div
      role="tablist"
      aria-label="Sidebar contents"
      className="flex items-center gap-0.5 rounded-md bg-secondary/50 p-0.5"
    >
      {SEGMENTS.map((item, index) => {
        const active = item.id === segment;
        const count = item.id === "inbox" ? inboxCount : 0;
        return (
          <button
            key={item.id}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={segmentTabId(item.id)}
            aria-controls={SIDEBAR_BODY_ID}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(item.id)}
            onKeyDown={(event) => {
              const direction = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (direction === 0) return;
              event.preventDefault();
              move(index, direction);
            }}
            className={cn(
              "flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              active
                ? "bg-card font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <item.icon
              className={cn(
                "size-3.5 shrink-0",
                active ? "text-primary" : "text-muted-foreground/60",
              )}
            />
            <span className="min-w-0 truncate">{item.label}</span>
            {count > 0 && (
              <span className="tnum shrink-0 text-[11px] font-semibold text-warn">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
