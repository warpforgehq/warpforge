import { Brain, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SkeletonBlock } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Memory } from "@/protocol";

import { collectTags, MEMORY_KINDS, type ScopeFilter } from "./labels";
import { MemoryRow } from "./MemoryRow";
import { useMemoryPages, useMemorySearch } from "./queries";

const SCOPES: { id: ScopeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "global", label: "Global" },
  { id: "project", label: "Project" },
];

const SELECT_CLASS = "h-7 min-w-0 flex-1 rounded-md border bg-background px-1.5 text-[12px]";

/** How close to the bottom (px) the list gets before the next page is fetched. */
const NEAR_END_PX = 240;

/**
 * The left column of the Memory screen: search, scope/kind/tag filters and the
 * scrolling list. Without a search term it pages through `memory.list` as you
 * scroll; with one it shows the ranked matches.
 *
 * @param props.selectedId The memory whose detail is open.
 * @param props.onSelect Called with a memory id on click.
 * @param props.hybrid Whether search can use embeddings.
 * @param props.onItems Reports the memories currently on screen.
 */
export function MemoryBrowser({
  selectedId,
  onSelect,
  hybrid,
  onItems,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  hybrid: boolean;
  onItems: (items: Memory[]) => void;
}) {
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [kind, setKind] = useState("all");
  const [tag, setTag] = useState("");
  const [input, setInput] = useState("");
  const [term, setTerm] = useState("");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(input.trim()), 250);
    return () => clearTimeout(timer);
  }, [input]);

  const pages = useMemoryPages(scope, kind);
  const search = useMemorySearch(term, scope, hybrid);
  const searching = term.length > 0;
  const active = searching ? search : pages;

  const loaded = useMemo(
    () => (searching ? (search.data ?? []) : (pages.data?.pages.flat() ?? [])),
    [searching, search.data, pages.data],
  );
  const tags = useMemo(() => collectTags(loaded), [loaded]);
  const items = useMemo(
    () =>
      loaded.filter(
        (m) => (!searching || kind === "all" || m.kind === kind) && (!tag || m.tags.includes(tag)),
      ),
    [loaded, searching, kind, tag],
  );

  useEffect(() => onItems(items), [items, onItems]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
  const wantMore = !searching && hasNextPage && !isFetchingNextPage;
  const farFromEnd = () => {
    const el = scroller.current;
    return !!el && el.scrollHeight - el.scrollTop - el.clientHeight > NEAR_END_PX;
  };
  // A tag filter can only be exhaustive over rows that were fetched, so it keeps paging.
  useEffect(() => {
    if (wantMore && (tag || !farFromEnd())) void fetchNextPage();
  }, [wantMore, tag, items.length, fetchNextPage]);

  return (
    <section aria-label="Memories" className="flex min-h-0 w-[22.5rem] shrink-0 flex-col gap-2">
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70"
        />
        <Input
          aria-label="Search memories"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search memories"
          className="h-8 pl-7 text-[13px]"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <div role="group" aria-label="Scope" className="flex shrink-0 rounded-md bg-muted/70 p-0.5">
          {SCOPES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={scope === item.id}
              onClick={() => setScope(item.id)}
              className={cn(
                "h-6 rounded px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground",
                scope === item.id && "bg-secondary font-medium text-foreground shadow-sm",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        <select
          aria-label="Kind"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
          className={SELECT_CLASS}
        >
          <option value="all">Any kind</option>
          {MEMORY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          aria-label="Tag"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">Any tag</option>
          {tag && !tags.includes(tag) && <option value={tag}>{tag}</option>}
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div
        ref={scroller}
        onScroll={() => {
          if (wantMore && !farFromEnd()) void fetchNextPage();
        }}
        className="min-h-0 flex-1 overflow-y-auto rounded-md border"
      >
        {active.isLoading ? (
          <div className="space-y-2 p-2.5">
            {Array.from({ length: 5 }, (_, index) => (
              <SkeletonBlock key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : active.error ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <p role="alert" className="text-[13px] text-destructive">
              {active.error instanceof Error ? active.error.message : "Could not load memories."}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => void active.refetch()}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            compact
            icon={searching ? Search : Brain}
            title={searching || tag || kind !== "all" ? "Nothing matches" : "No memories yet"}
            hint={
              searching || tag || kind !== "all"
                ? "Try a different word, or clear a filter."
                : "Agents save durable facts here as they work. They will show up in this list."
            }
          />
        ) : (
          <ul className="p-1">
            {items.map((memory) => (
              <li key={memory.id}>
                <MemoryRow
                  memory={memory}
                  selected={memory.id === selectedId}
                  onSelect={onSelect}
                />
              </li>
            ))}
            {isFetchingNextPage && (
              <li className="p-2 text-center text-[12px] text-muted-foreground">Loading more…</li>
            )}
            {searching && items.length >= 100 && (
              <li className="p-2 text-center text-[12px] text-muted-foreground">
                Showing the top 100 matches. Narrow the search to see others.
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
