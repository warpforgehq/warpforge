import { useEffect, useRef } from "react";

import type { SidebarMode } from "@/store/ui";

/** ⌥⌘1–3, by physical key: ⌥ turns the digit into another character on macOS,
 *  and plain ⌘1–9 already switch a task's workspace surfaces. */
const MODE_KEYS: Record<string, SidebarMode> = {
  Digit1: "tasks",
  Digit2: "inbox",
  Digit3: "team",
};

/**
 * Global shell shortcuts that must live above the sidebar, because the sidebar
 * is unmounted while collapsed on narrow windows.
 */
export function useShellShortcuts(
  onNewTask: () => void,
  onToggleSidebarCollapsed: () => void,
  onSelectMode?: (mode: SidebarMode) => void,
): void {
  const selectMode = useRef(onSelectMode);
  selectMode.current = onSelectMode;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey) return;
      const mode = MODE_KEYS[event.code];
      if (!mode || !selectMode.current) return;
      event.preventDefault();
      selectMode.current(mode);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The sidebar advertises ⌘N next to New task, so the shortcut lives here
  // rather than inside the sidebar, which is unmounted while it is closed.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "n") return;
      event.preventDefault();
      onNewTask();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onNewTask]);

  // ⌘\ toggles the sidebar the way most editors bind it — chrome was
  // otherwise reachable only by mouse.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key !== "\\") return;
      event.preventDefault();
      onToggleSidebarCollapsed();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onToggleSidebarCollapsed]);
}
