import { useEffect } from "react";

import { browser, type BrowserBounds } from "./browserClient";

function boundsOf(el: HTMLElement): BrowserBounds {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

/**
 * Keep the active tab's native webview glued to the placeholder and visible.
 *
 * The webview is a native view painted over the page in its rectangle, not a
 * DOM node, so it has to be positioned by hand and hidden the moment the
 * surface is no longer showing — otherwise it floats over whatever replaces it.
 *
 * Switching tabs runs the cleanup for the old tab (hide) before the new effect
 * (show + position), so exactly one content view is ever visible.
 */
export function useBrowserViewport(activeTabId: string | null, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!activeTabId || !el) return;

    let cancelled = false;
    const sync = () => {
      if (!cancelled) void browser.setBounds(activeTabId, boundsOf(el));
    };

    void browser.setVisible(activeTabId, true).then(sync);

    // The placeholder moves with the split resizer and the window; a scroll of
    // an ancestor moves it too. ResizeObserver catches size, the listeners catch
    // position.
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
      void browser.setVisible(activeTabId, false);
    };
  }, [activeTabId, ref]);
}
