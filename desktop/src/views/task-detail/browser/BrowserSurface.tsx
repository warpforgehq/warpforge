import { ArrowLeft, ArrowRight, Plus, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { IS_TAURI } from "@/lib/platform";
import { cn } from "@/lib/utils";

import { browser, type BrowserBounds } from "./browserClient";
import { toDisplayUrl } from "./browserUrl";
import { useBrowserTabs } from "./useBrowserTabs";
import { useBrowserViewport } from "./useBrowserViewport";

function boundsOf(el: HTMLElement): BrowserBounds {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function BrowserSurface() {
  const { activeId, back, closeTab, forward, navigate, newTab, reload, setActive, stop, tabs } =
    useBrowserTabs();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const opened = useRef(new Set<string>());
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);

  const active = tabs.find((t) => t.id === activeId) ?? null;

  // Create the native webview the first time a tab is shown; later activations
  // are handled by the viewport hook, which must not re-navigate.
  useEffect(() => {
    const el = pageRef.current;
    if (!active || !el || opened.current.has(active.id)) return;
    opened.current.add(active.id);
    void browser.open(active.id, active.url, boundsOf(el));
  }, [active]);

  useBrowserViewport(activeId, pageRef);

  // The address bar follows the page unless the user is typing in it.
  useEffect(() => {
    if (!editing) setDraft(active ? toDisplayUrl(active.url) : "");
  }, [active, editing]);

  if (!IS_TAURI) {
    return (
      <EmptyState
        title="The browser needs the desktop app"
        hint="Open warpforge as the desktop app to browse in a task."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 px-2 pt-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            className={cn(
              "group flex min-w-0 max-w-[180px] items-center gap-1.5 rounded-t px-2.5 py-1.5 text-xs",
              tab.id === activeId ? "bg-card" : "bg-transparent text-muted-foreground hover:bg-card/50",
            )}
          >
            <span className="truncate">{tab.loading ? "Loading…" : tab.title}</span>
            <span
              role="button"
              tabIndex={-1}
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="shrink-0 rounded p-0.5 opacity-0 hover:bg-muted group-hover:opacity-100"
            >
              <X className="size-3" />
            </span>
          </button>
        ))}
        <Button size="sm" variant="ghost" aria-label="New tab" onClick={newTab}>
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b bg-card px-2 py-1.5">
        <Button size="sm" variant="ghost" aria-label="Back" onClick={back}>
          <ArrowLeft className="size-4" />
        </Button>
        <Button size="sm" variant="ghost" aria-label="Forward" onClick={forward}>
          <ArrowRight className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={active?.loading ? "Stop" : "Reload"}
          onClick={() => (active?.loading ? stop() : reload())}
        >
          {active?.loading ? <X className="size-4" /> : <RotateCw className="size-4" />}
        </Button>
        <Input
          value={draft}
          placeholder="Search or enter address"
          spellCheck={false}
          className="h-7 flex-1 text-xs"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              navigate(draft);
              e.currentTarget.blur();
            }
          }}
        />
      </div>

      {/* The native page view is painted over this rectangle. It stays empty. */}
      <div ref={pageRef} className="min-h-0 flex-1 bg-white" />
    </div>
  );
}
