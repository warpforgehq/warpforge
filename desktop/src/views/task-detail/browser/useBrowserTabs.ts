import { useCallback, useEffect, useRef, useState } from "react";

import { browser, onBrowserState, onBrowserTitle } from "./browserClient";
import { loadBrowserSession, saveBrowserSession } from "./browserSession";
import { toNavigationUrl } from "./browserUrl";

export interface BrowserTab {
  id: string;
  /** The URL actually showing, updated from navigation events. */
  url: string;
  title: string;
  loading: boolean;
}

const HOME = "https://duckduckgo.com";

/** The id is the native webview label's suffix, prefixed with the project so a
 *  removed project's views can be closed as a group and never collide. */
function makeTab(project: string, url: string): BrowserTab {
  return { id: `${project}:${crypto.randomUUID()}`, url, title: "New tab", loading: false };
}

export interface BrowserTabs {
  tabs: BrowserTab[];
  activeId: string | null;
  newTab: () => void;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  navigate: (input: string) => void;
  back: () => void;
  forward: () => void;
  reload: () => void;
  stop: () => void;
}

export function useBrowserTabs(project: string): BrowserTabs {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => {
    const saved = loadBrowserSession(project);
    if (saved) {
      return saved.tabs.map((t) => ({ id: t.id, url: t.url, title: "New tab", loading: false }));
    }
    return [makeTab(project, HOME)];
  });
  const [activeId, setActiveId] = useState<string | null>(
    () => loadBrowserSession(project)?.activeId ?? null,
  );

  // First tab becomes active once, after mount, so the surface can open it.
  useEffect(() => {
    setActiveId((current) =>
      current && tabs.some((t) => t.id === current) ? current : (tabs[0]?.id ?? null),
    );
  }, [tabs]);

  // Persist the open pages so a restart reopens them into the kept-alive login.
  useEffect(() => {
    saveBrowserSession(project, { tabs: tabs.map((t) => ({ id: t.id, url: t.url })), activeId });
  }, [project, tabs, activeId]);

  useEffect(() => {
    const unstate = onBrowserState(({ tabId, url, loading }) => {
      setTabs((list) =>
        list.map((t) => (t.id === tabId ? { ...t, url, loading } : t)),
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

  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const newTab = useCallback(() => {
    const tab = makeTab(project, HOME);
    setTabs((list) => [...list, tab]);
    setActiveId(tab.id);
  }, [project]);

  const closeTab = useCallback((id: string) => {
    void browser.close(id);
    setTabs((list) => {
      const next = list.filter((t) => t.id !== id);
      setActiveId((current) => {
        if (current !== id) return current;
        const idx = list.findIndex((t) => t.id === id);
        return next[Math.min(idx, next.length - 1)]?.id ?? null;
      });
      return next;
    });
  }, []);

  const setActive = useCallback((id: string) => setActiveId(id), []);

  const navigate = useCallback((input: string) => {
    const id = activeRef.current;
    if (id) void browser.navigate(id, toNavigationUrl(input));
  }, []);

  const back = useCallback(() => {
    if (activeRef.current) void browser.back(activeRef.current);
  }, []);
  const forward = useCallback(() => {
    if (activeRef.current) void browser.forward(activeRef.current);
  }, []);
  const reload = useCallback(() => {
    if (activeRef.current) void browser.reload(activeRef.current);
  }, []);
  const stop = useCallback(() => {
    if (activeRef.current) void browser.stop(activeRef.current);
  }, []);

  return { tabs, activeId, newTab, closeTab, setActive, navigate, back, forward, reload, stop };
}
