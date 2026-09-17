import { MessageSquare } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useMediaQuery } from "@/hooks/useMediaQuery";

import { SurfaceRailButton } from "./SurfaceRailButton";
import { surfaceSummary } from "./surfaceRailMeta";
import type { SurfaceTab, WorkspaceSurface } from "./SurfaceTabs";

const CONVERSATION_KEY = "conversation";

interface RailItem {
  key: string;
  icon: SurfaceTab["icon"];
  label: string;
  summary: string;
  shortcut: string;
  surface: WorkspaceSurface | null;
}

export interface SurfaceRailProps {
  tabs: readonly SurfaceTab[];
  activeSurface: WorkspaceSurface;
  onSurfaceChange: (surface: WorkspaceSurface) => void;
  chatVisible: boolean;
  surfaceVisible: boolean;
  /** Focus the conversation, or bring it back when the workspace owns the split. */
  onConversation: () => void;
}

/**
 * The single surface switcher for the task workspace: a vertical toolbar of
 * the conversation plus every surface, always on screen — including while one
 * of the two panes is folded away, which is the state that used to leave no
 * trace of the other half.
 *
 * Selection is one travelling background chip rather than a fill per button, so
 * a move between two items is a continuous trip that can be retargeted mid-flight.
 */
export function SurfaceRail({
  tabs,
  activeSurface,
  onSurfaceChange,
  chatVisible,
  surfaceVisible,
  onConversation,
}: SurfaceRailProps) {
  const railRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const snapRef = useRef(true);
  const [tabbable, setTabbable] = useState(CONVERSATION_KEY);

  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const items = useMemo<RailItem[]>(
    () => [
      {
        icon: MessageSquare,
        key: CONVERSATION_KEY,
        label: "Conversation",
        shortcut: "⌘1",
        summary: chatVisible ? "Open" : "Hidden",
        surface: null,
      },
      ...tabs.map((tab, index) => ({
        icon: tab.icon,
        key: `surface:${tab.id}`,
        label: tab.label,
        shortcut: `⌘${index + 2}`,
        summary: surfaceSummary(tab),
        surface: tab.id,
      })),
    ],
    [chatVisible, tabs],
  );

  const surfaceKey = tabs.some((tab) => tab.id === activeSurface)
    ? `surface:${activeSurface}`
    : items[1]?.key;
  const pillKey = surfaceVisible ? surfaceKey : CONVERSATION_KEY;
  const ghostKey = surfaceVisible ? (chatVisible ? null : CONVERSATION_KEY) : surfaceKey;

  const activate = useCallback(
    (item: RailItem, fromKeyboard: boolean) => {
      snapRef.current = fromKeyboard;
      if (item.surface) onSurfaceChange(item.surface);
      else onConversation();
    },
    [onConversation, onSurfaceChange],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= items.length) return;
      event.preventDefault();
      activate(items[index], true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activate, items]);

  // One tab stop for the whole rail; arrows, Home and End move within it.
  const onKeyDown = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const buttons = Array.from(
      railRef.current?.querySelectorAll<HTMLButtonElement>("[data-rail-item]") ?? [],
    );
    if (buttons.length === 0) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const last = buttons.length - 1;
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % buttons.length;
    else if (event.key === "ArrowUp")
      next = current < 0 ? last : (current - 1 + buttons.length) % buttons.length;
    else if (event.key === "Home") next = 0;
    else next = last;
    event.preventDefault();
    buttons[next]?.focus();
  }, []);

  const onItemFocus = useCallback((element: HTMLButtonElement) => {
    setTabbable(element.dataset.railKey ?? CONVERSATION_KEY);
  }, []);

  // The chip is placed and sized from live rects rather than an index, so it
  // covers its button whatever the rail's own metrics resolve to.
  useLayoutEffect(() => {
    const rail = railRef.current;
    const pill = pillRef.current;
    if (!rail || !pill) return;
    const place = () => {
      const target = rail.querySelector<HTMLElement>(`[data-rail-key="${pillKey}"]`);
      if (!target) {
        pill.style.opacity = "0";
        return;
      }
      const item = target.getBoundingClientRect();
      const box = rail.getBoundingClientRect();
      const x = item.left - box.left;
      const y = item.top - box.top;
      const snap = snapRef.current || reduceMotion;
      pill.style.transition = snap ? "none" : "";
      pill.style.width = `${item.width}px`;
      pill.style.height = `${item.height}px`;
      pill.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      pill.style.opacity = "1";
      // Restoring the curve needs the suppressed move to have been committed
      // first, or the next trip starts from where this one began.
      if (snap && !reduceMotion) {
        void pill.offsetWidth;
        pill.style.transition = "";
      }
      snapRef.current = false;
    };
    place();
    const observer = new ResizeObserver(() => {
      snapRef.current = true;
      place();
    });
    observer.observe(rail);
    return () => observer.disconnect();
  }, [pillKey, reduceMotion, items]);

  // Pipeline comes and goes with the task, and a tab stop parked on a button
  // that no longer exists drops the whole rail out of the tab order.
  const tabStop = items.some((item) => item.key === tabbable) ? tabbable : CONVERSATION_KEY;

  return (
    <nav
      ref={railRef}
      data-testid="surface-rail"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Workspace rail"
      onKeyDown={onKeyDown}
      className="relative flex w-7 shrink-0 flex-col items-center gap-1"
    >
      <span
        ref={pillRef}
        aria-hidden
        data-rail-pill
        style={{ opacity: 0 }}
        className="pointer-events-none absolute left-0 top-0 z-0 rounded-md bg-primary transition-transform duration-[180ms] ease-[var(--ease-fold)] will-change-transform"
      />
      {items.map((item) => (
        <SurfaceRailButton
          key={item.key}
          railKey={item.key}
          icon={item.icon}
          label={item.label}
          summary={item.summary}
          shortcut={item.shortcut}
          active={item.key === pillKey}
          ghost={item.key === ghostKey}
          onSelect={(fromKeyboard) => activate(item, fromKeyboard)}
          onFocus={onItemFocus}
          tabIndex={tabStop === item.key ? 0 : -1}
        />
      ))}
      <span className="flex-1" />
    </nav>
  );
}
