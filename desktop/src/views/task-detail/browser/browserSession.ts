/**
 * The open tabs, remembered across restarts.
 *
 * The native content webviews do not survive an app restart, but the login
 * cookies do; persisting the tab list here lets the browser reopen the same
 * pages into that still-logged-in session. Tiny data, so localStorage rather
 * than a migration of the IndexedDB session schema.
 */
const KEY = "warpforge.browser.session";

export interface PersistedTab {
  id: string;
  url: string;
}

export interface BrowserSession {
  tabs: PersistedTab[];
  activeId: string | null;
}

export function loadBrowserSession(): BrowserSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BrowserSession;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveBrowserSession(session: BrowserSession): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // A full or disabled store just means tabs are not remembered.
  }
}
