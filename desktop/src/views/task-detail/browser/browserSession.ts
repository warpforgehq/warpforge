/**
 * The open tabs, remembered per project across restarts.
 *
 * The native content webviews do not survive a restart, but the login cookies
 * do; persisting the tab list lets the browser reopen the same pages into that
 * still-logged-in session. Scoped per project — unrelated projects never share
 * a browser — and cleared when a project is removed.
 *
 * Tiny data, so localStorage rather than a migration of the IndexedDB session
 * schema; the per-project key is what makes cleanup a single `remove`.
 */
import type { BrowserTab } from "./useBrowserTabs";

const PREFIX = "warpforge.browser.";

export interface PersistedTab {
  id: string;
  url: string;
}

export interface BrowserSession {
  tabs: PersistedTab[];
  activeId: string | null;
}

export interface LiveBrowserSession {
  tabs: BrowserTab[];
  activeId: string | null;
}

/** The tabs as last rendered, for this app run. A remounted pane reuses the
 *  still-open webviews, which report no new title or history, so it takes
 *  those from here rather than from the saved session. */
const live = new Map<string, LiveBrowserSession>();

export function loadLiveBrowserSession(project: string): LiveBrowserSession | null {
  return live.get(project) ?? null;
}

export function saveLiveBrowserSession(project: string, session: LiveBrowserSession): void {
  live.set(project, session);
}

function keyFor(project: string): string {
  return `${PREFIX}${project}`;
}

export function loadBrowserSession(project: string): BrowserSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(keyFor(project));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BrowserSession;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveBrowserSession(project: string, session: BrowserSession): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(keyFor(project), JSON.stringify(session));
  } catch {
    // A full or disabled store just means tabs are not remembered.
  }
}

/** Called when a project is removed, so its tabs do not outlive it. */
export function clearBrowserSession(project: string): void {
  live.delete(project);
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(keyFor(project));
}

/** The project a tab belongs to: tab ids are `<project>:<uuid>`. */
function projectOf(tabId: string): string {
  return tabId.slice(0, tabId.lastIndexOf(":"));
}

/**
 * Record a page a tab moved to while no pane was tracking it, as when an agent
 * drives the browser in the background, so a pane mounted later shows that
 * page instead of the one it last rendered.
 * @param tabId the tab
 * @param page the tab's new address or title
 */
export function recordTabPage(tabId: string, page: { url?: string; title?: string }): void {
  const project = projectOf(tabId);
  const current = live.get(project);
  if (current?.tabs.some((t) => t.id === tabId)) {
    const tabs = current.tabs.map((t) => (t.id === tabId ? { ...t, ...page } : t));
    live.set(project, { ...current, tabs });
  }
  const saved = loadBrowserSession(project);
  if (page.url && saved?.tabs.some((t) => t.id === tabId)) {
    const url = page.url;
    const tabs = saved.tabs.map((t) => (t.id === tabId ? { ...t, url } : t));
    saveBrowserSession(project, { ...saved, tabs });
  }
}

type AgentTabListener = (tab: { id: string; url: string; title?: string }) => void;
const agentTabListeners = new Map<string, Set<AgentTabListener>>();

/**
 * Follow the agent's tab being shown in a project's browser.
 * @param project the project
 * @param listener called with the tab to add, if missing, and make active
 * @returns stops following
 */
export function onAgentTab(project: string, listener: AgentTabListener): () => void {
  let listeners = agentTabListeners.get(project);
  if (!listeners) {
    listeners = new Set();
    agentTabListeners.set(project, listeners);
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Put the agent's tab into the project's tab list and make it the active tab,
 * in a pane showing the project now and in one mounted later.
 * @param project the project
 * @param tab the agent's tab and the address it is loading
 */
export function showAgentTab(
  project: string,
  tab: { id: string; url: string; title?: string },
): void {
  const saved = loadBrowserSession(project);
  const current: LiveBrowserSession = live.get(project) ?? {
    tabs: (saved?.tabs ?? []).map((t) => ({
      id: t.id,
      url: t.url,
      title: "New tab",
      loading: false,
      entries: [t.url],
      pos: 0,
    })),
    activeId: saved?.activeId ?? null,
  };
  const known = current.tabs.some((t) => t.id === tab.id);
  const tabs = known
    ? current.tabs
    : [
        ...current.tabs,
        {
          id: tab.id,
          url: tab.url,
          title: tab.title ?? "Agent",
          loading: true,
          entries: [tab.url],
          pos: 0,
        },
      ];
  live.set(project, { tabs, activeId: tab.id });
  saveBrowserSession(project, {
    tabs: tabs.map((t) => ({ id: t.id, url: t.url })),
    activeId: tab.id,
  });
  for (const listener of agentTabListeners.get(project) ?? []) listener(tab);
}

/**
 * Open `url` in a new tab of the project's browser and make it the active tab.
 * @param project the project
 * @param url the address to load
 */
export function openUrlInBrowser(project: string, url: string): void {
  showAgentTab(project, { id: `${project}:${crypto.randomUUID()}`, url, title: "New tab" });
}
