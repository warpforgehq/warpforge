import { useEffect } from "react";

/**
 * Global shell shortcuts that must live above the sidebar, because the sidebar
 * is unmounted while collapsed on narrow windows.
 */
export function useShellShortcuts(
  onNewTask: () => void,
  onToggleSidebarCollapsed: () => void,
): void {
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
