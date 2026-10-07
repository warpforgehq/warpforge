import { useCallback, useEffect, useRef, useState } from "react";

import { browser, onBrowserState, onBrowserTitle } from "./browserClient";
import {
  loadBrowserSession,
  loadLiveBrowserSession,
  onAgentTab,
  saveBrowserSession,
  saveLiveBrowserSession,
} from "./browserSession";

export interface BrowserTab {
  id: string;
  /** The URL actually showing, updated from navigation events. */
  url: string;
  title: string;
  loading: boolean;
  /** Client-side history: WKWebView exposes no canGoBack, so it is tracked
   *  here from navigation events to grey the back/forward buttons. */
  entries: string[];
  pos: number;
}

/** A new tab shows the start page instead of loading a site; no native webview
 *  exists until the user opens something. */
export const BROWSER_START = "about:blank";

export function isStartUrl(url: string): boolean {
  return url === BROWSER_START || url.length === 0;
}

/** The id is the native webview label's suffix, prefixed with the project so a
 *  removed project's views can be closed as a group and never collide. */
function makeTab(project: string, url: string): BrowserTab {
  return {
    id: `${project}:${crypto.randomUUID()}`,
    url,
    title: "New tab",
    loading: false,
    entries: [url],
    pos: 0,
  };
}

export interface BrowserTabs {
  tabs: BrowserTab[];
  activeId: string | null;
  canBack: boolean;
  canForward: boolean;
  newTab: () => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  /** Optimistically set a tab's URL so the start page yields to the webview
   *  immediately, before the page's first navigation event lands. */
  setTabUrl: (id: string, url: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
}

export function useBrowserTabs(project: string): BrowserTabs {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => {
    const current = loadLiveBrowserSession(project);
    // A load that finished while the pane was away never reported back.
    if (current) return current.tabs.map((t) => ({ ...t, loading: false }));
    const saved = loadBrowserSession(project);
    if (saved) {
      return saved.tabs.map((t) => ({
        id: t.id,
        url: t.url,
        title: "New tab",
        loading: false,
        entries: [t.url],
        pos: 0,
      }));
    }
    return [makeTab(project, BROWSER_START)];
  });
  // A back/forward click is expected to move the position rather than push a
  // new entry; the next navigation event for that tab consumes this.
  const pendingMove = useRef(new Map<string, number>());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const current = loadLiveBrowserSession(project);
    return current ? current.activeId : (loadBrowserSession(project)?.activeId ?? null);
  });

  // First tab becomes active once, after mount, so the surface can open it.
  useEffect(() => {
    setActiveId((current) =>
      current && tabs.some((t) => t.id === current) ? current : (tabs[0]?.id ?? null),
    );
  }, [tabs]);

  // Persist the open pages so a restart reopens them into the kept-alive login.
  useEffect(() => {
    saveLiveBrowserSession(project, { tabs, activeId });
    saveBrowserSession(project, { tabs: tabs.map((t) => ({ id: t.id, url: t.url })), activeId });
  }, [project, tabs, activeId]);

  useEffect(() => {
    const unstate = onBrowserState(({ tabId, url, loading }) => {
      setTabs((list) =>
        list.map((t) => {
          if (t.id !== tabId) return t;
          const next = { ...t, url, loading };
          // History only advances at the start of a navigation (the address
          // changing), not on the load-finished echo of the same url.
          if (!loading) return next;
          const move = pendingMove.current.get(tabId);
          if (move !== undefined) {
            pendingMove.current.delete(tabId);
            next.pos = Math.min(Math.max(t.pos + move, 0), t.entries.length - 1);
          } else if (url !== t.entries[t.pos]) {
            if (isStartUrl(t.entries[t.pos])) {
              // The first real load replaces the start entry, so back does not
              // return to a blank page.
              next.entries = [...t.entries];
              next.entries[t.pos] = url;
            } else {
              next.entries = [...t.entries.slice(0, t.pos + 1), url];
              next.pos = next.entries.length - 1;
            }
          }
          return next;
        }),
      );
    });
    const untitle = onBrowserTitle(({ tabId, title }) => {
      setTabs((list) =>
        list.map((t) => (t.id === tabId && title.length > 0 ? { ...t, title } : t)),
      );
    });
    return () => {
      void unstate.then((off) => off());
      void untitle.then((off) => off());
    };
  }, []);

  // The agent's tab joins the strip and takes focus when the agent opens a page,
  // so what it acts on is what the pane shows.
  useEffect(
    () =>
      onAgentTab(project, ({ id, url, title = "Agent" }) => {
        setTabs((list) =>
          list.some((t) => t.id === id)
            ? list
            : [...list, { id, url, title, loading: true, entries: [url], pos: 0 }],
        );
        setActiveId(id);
      }),
    [project],
  );

  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const newTab = useCallback(() => {
    const tab = makeTab(project, BROWSER_START);
    setTabs((list) => [...list, tab]);
    setActiveId(tab.id);
  }, [project]);

  const closeTab = useCallback(
    (id: string) => {
      void browser.close(id);
      // Closing the last tab leaves a fresh one, so the browser always has a
      // tab for the address bar to load into.
      const fresh = makeTab(project, BROWSER_START);
      setTabs((list) => {
        const rest = list.filter((t) => t.id !== id);
        return rest.length > 0 ? rest : [fresh];
      });
      if (activeRef.current !== id) return;
      const list = tabsRef.current;
      const rest = list.filter((t) => t.id !== id);
      const idx = list.findIndex((t) => t.id === id);
      setActiveId(rest.length > 0 ? rest[Math.min(idx, rest.length - 1)].id : fresh.id);
    },
    [project],
  );

  const setActive = useCallback((id: string) => setActiveId(id), []);

  const setTabUrl = useCallback((id: string, url: string) => {
    setTabs((list) => list.map((t) => (t.id === id ? { ...t, url } : t)));
  }, []);

  const back = useCallback(() => {
    const id = activeRef.current;
    if (id) {
      pendingMove.current.set(id, -1);
      void browser.back(id);
    }
  }, []);
  const forward = useCallback(() => {
    const id = activeRef.current;
    if (id) {
      pendingMove.current.set(id, 1);
      void browser.forward(id);
    }
  }, []);
  const reload = useCallback(() => {
    if (activeRef.current) void browser.reload(activeRef.current);
  }, []);
  const stop = useCallback(() => {
    if (activeRef.current) void browser.stop(activeRef.current);
  }, []);

  const active = tabs.find((t) => t.id === activeId);
  const canBack = !!active && active.pos > 0;
  const canForward = !!active && active.pos < active.entries.length - 1;

  return {
    tabs,
    activeId,
    canBack,
    canForward,
    newTab,
    closeTab,
    setActive,
    setTabUrl,
    back,
    forward,
    reload,
    stop,
  };
}
