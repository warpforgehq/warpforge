import { ArrowLeft, ArrowRight, Globe, MousePointerClick, Plus, RotateCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { IS_TAURI } from "@/lib/platform";
import { cn } from "@/lib/utils";

import {
  browser,
  onBrowserAnnotation,
  onBrowserShot,
  onBrowserState,
  type BrowserAnnotation,
  type BrowserBounds,
} from "./browserClient";
import { toDisplayUrl } from "./browserUrl";
import { annotationLabel, formatAnnotation } from "./formatAnnotation";
import { useBrowserTabs } from "./useBrowserTabs";
import { useBrowserViewport } from "./useBrowserViewport";

function boundsOf(el: HTMLElement): BrowserBounds {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/** The origin's favicon, falling back to a globe when the site has none. */
function TabIcon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  let src: string | null = null;
  try {
    src = `${new URL(url).origin}/favicon.ico`;
  } catch {
    src = null;
  }
  if (!src || failed) return <Globe className="size-3.5 shrink-0 text-muted-foreground" />;
  return (
    <img alt="" src={src} onError={() => setFailed(true)} className="size-3.5 shrink-0 rounded-sm" />
  );
}

interface Props {
  project: string;
  /** Adds a picked element to the agent's chat composer as a context chip. */
  onAnnotate?: (chip: { id: string; label: string; body: string }) => void;
  /** Fills a chip's screenshot in once the capture returns. */
  onShot?: (chipId: string, image: { name: string; base64: string }) => void;
}

export function BrowserSurface({ onAnnotate, onShot, project }: Props) {
  const {
    activeId,
    back,
    canBack,
    canForward,
    closeTab,
    forward,
    navigate,
    newTab,
    reload,
    setActive,
    stop,
    tabs,
  } = useBrowserTabs(project);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const addressRef = useRef<HTMLInputElement | null>(null);
  const opened = useRef(new Set<string>());
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);

  const active = tabs.find((t) => t.id === activeId) ?? null;

  // Pick mode belongs to the active tab; leaving it or switching tab ends it.
  useEffect(() => setPicking(false), [activeId]);

  const togglePick = () => {
    if (!activeId) return;
    if (picking) {
      void browser.pickStop(activeId);
      setPicking(false);
    } else {
      void browser.pick(activeId);
      setPicking(true);
    }
  };

  // Create the native webview the first time a tab is shown; later activations
  // are handled by the viewport hook, which must not re-navigate.
  useEffect(() => {
    const el = pageRef.current;
    if (!active || !el || opened.current.has(active.id)) return;
    opened.current.add(active.id);
    void browser.open(active.id, active.url, boundsOf(el));
  }, [active]);

  useBrowserViewport(activeId, pageRef);

  // A picked element arrives as an event from the page; add it as a chip and,
  // when the composer takes images, a screenshot of it. The page's picker stops
  // itself after a pick, so the toggle returns to off.
  useEffect(() => {
    const sub = onBrowserAnnotation(({ annotation, tabId }) => {
      if (!tabId.startsWith(`${project}:`)) return;
      const a: BrowserAnnotation = annotation;
      const id = crypto.randomUUID();
      onAnnotate?.({ id, label: annotationLabel(a), body: formatAnnotation(a) });
      // The capture id is the chip id, so the screenshot lands in this chip.
      if (onShot) void browser.captureElement(tabId, id, a.rect);
      setPicking(false);
    });
    return () => void sub.then((off) => off());
  }, [project, onAnnotate, onShot]);

  // The screenshot arrives asynchronously and fills in its chip.
  useEffect(() => {
    if (!onShot) return;
    const sub = onBrowserShot(({ captureId, pngBase64 }) => {
      onShot(captureId, { name: `element-${Date.now()}.png`, base64: pngBase64 });
    });
    return () => void sub.then((off) => off());
  }, [onShot]);

  // A navigation (back/forward/reload/link) drops pick mode in the page, so the
  // toggle follows it back to off.
  useEffect(() => {
    const sub = onBrowserState(({ loading, tabId }) => {
      if (loading && tabId === activeId) setPicking(false);
    });
    return () => void sub.then((off) => off());
  }, [activeId]);

  // The address bar follows the page unless the user is typing in it.
  useEffect(() => {
    if (!editing) setDraft(active ? toDisplayUrl(active.url) : "");
  }, [active, editing]);

  // Browser keyboard shortcuts, live while the surface is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      if (e.key === "l") {
        e.preventDefault();
        addressRef.current?.focus();
        addressRef.current?.select();
      } else if (e.key === "t") {
        e.preventDefault();
        newTab();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newTab]);

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
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={cn(
                "group flex w-[160px] shrink-0 items-center gap-1.5 rounded-t border border-b-0 border-t-2 px-2.5 py-1.5 text-xs",
                tab.id === activeId
                  ? "border-border border-t-primary bg-muted text-foreground"
                  : "border-transparent bg-card/40 text-muted-foreground hover:bg-muted/40",
              )}
            >
              <TabIcon url={tab.url} />
              <span className="min-w-0 flex-1 truncate text-left">{tab.title}</span>
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
        </div>
        <Button size="sm" variant="ghost" aria-label="New tab" className="shrink-0" onClick={newTab}>
          <Plus className="size-3.5" />
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b bg-card px-2 py-1.5">
        <Button size="sm" variant="ghost" aria-label="Back" disabled={!canBack} onClick={back}>
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Forward"
          disabled={!canForward}
          onClick={forward}
        >
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
        {onAnnotate && (
          <Button
            size="sm"
            variant={picking ? "default" : "ghost"}
            aria-pressed={picking}
            aria-label={picking ? "Cancel picking (Esc)" : "Point out an element to the agent"}
            title={picking ? "Cancel picking (Esc)" : "Point out an element to the agent"}
            onClick={togglePick}
          >
            <MousePointerClick className="size-4" />
          </Button>
        )}
        <Input
          ref={addressRef}
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

      {/* Indeterminate progress while the active tab loads. */}
      <div className="h-0.5 shrink-0 overflow-hidden bg-transparent">
        {active?.loading && <div className="h-full w-1/3 animate-browser-progress bg-primary" />}
      </div>

      {/* The native page view is painted over this rectangle. It stays empty. */}
      <div ref={pageRef} className="min-h-0 flex-1 bg-white" />
    </div>
  );
}
