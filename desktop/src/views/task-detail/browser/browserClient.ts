import { IS_TAURI } from "@/lib/platform";

/** A rectangle in CSS pixels, matching the placeholder the page sits behind. */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserStateEvent {
  tabId: string;
  url: string;
  loading: boolean;
}

export interface BrowserTitleEvent {
  tabId: string;
  url: string;
  title: string;
}

export interface BrowserAnnotation {
  url: string;
  selector: string;
  role: string;
  text: string;
  href: string | null;
  rect: { x: number; y: number; width: number; height: number };
}

export interface BrowserShotEvent {
  captureId: string;
  pngBase64: string;
}

export interface BrowserAnnotationEvent {
  tabId: string;
  annotation: BrowserAnnotation;
}

async function call(command: string, args: Record<string, unknown>): Promise<void> {
  if (!IS_TAURI) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(command, args);
}

/** The error a tab command gives when the tab has no native view yet. */
export const NO_TAB = "no such browser tab";

async function ask<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("the browser needs the desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

/** A tab's webview is created shown; a hide sent while it is still being
 *  created would find no view, so visibility waits for the open to land. */
const opening = new Map<string, Promise<unknown>>();

export const browser = {
  /** With `reuse`, a tab whose webview already exists keeps its page instead
   *  of loading `url` again; with `hidden`, a new webview starts out of sight. */
  open(
    tabId: string,
    url: string,
    bounds: BrowserBounds,
    reuse = false,
    hidden = false,
  ): Promise<void> {
    const done = call("browser_open", { tabId, url, ...bounds, reuse, hidden });
    const settled = done.catch(() => {});
    opening.set(tabId, settled);
    return done;
  },
  navigate(tabId: string, url: string): Promise<void> {
    return call("browser_navigate", { tabId, url });
  },
  back(tabId: string): Promise<void> {
    return call("browser_back", { tabId });
  },
  forward(tabId: string): Promise<void> {
    return call("browser_forward", { tabId });
  },
  reload(tabId: string): Promise<void> {
    return call("browser_reload", { tabId });
  },
  stop(tabId: string): Promise<void> {
    return call("browser_stop", { tabId });
  },
  setBounds(tabId: string, bounds: BrowserBounds): Promise<void> {
    return call("browser_set_bounds", { tabId, ...bounds });
  },
  setVisible(tabId: string, visible: boolean): Promise<void> {
    const pending = opening.get(tabId) ?? Promise.resolve();
    return pending.then(() => call("browser_set_visible", { tabId, visible }));
  },
  close(tabId: string): Promise<void> {
    opening.delete(tabId);
    return call("browser_close", { tabId });
  },
  closeProject(project: string): Promise<void> {
    return call("browser_close_project", { project });
  },
  pick(tabId: string): Promise<void> {
    return call("browser_pick", { tabId });
  },
  pickStop(tabId: string): Promise<void> {
    return call("browser_pick_stop", { tabId });
  },
  captureElement(
    tabId: string,
    captureId: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<void> {
    return call("browser_capture_element", { tabId, captureId, ...rect });
  },
  /** Run an agent's page call (outline, click, type, console) in the tab. */
  agentCall(tabId: string, request: unknown, allowedOrigins: string[]): Promise<unknown> {
    return ask("browser_agent_call", { tabId, call: request, allowedOrigins });
  },
  /** Screenshot the tab for an agent. */
  agentScreenshot(tabId: string, allowedOrigins: string[]): Promise<unknown> {
    return ask("browser_agent_screenshot", { tabId, allowedOrigins });
  },
  /** Load an agent's HTML page off screen, themed by `fragment`, and screenshot it. */
  htmlPreview(html: string, width: number, fragment: string): Promise<Record<string, unknown>> {
    return ask("html_preview", { html, width, fragment });
  },
};

async function subscribe<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!IS_TAURI) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (e) => handler(e.payload));
}

export function onBrowserState(handler: (e: BrowserStateEvent) => void): Promise<() => void> {
  return subscribe("browser:state", handler);
}

export function onBrowserTitle(handler: (e: BrowserTitleEvent) => void): Promise<() => void> {
  return subscribe("browser:title", handler);
}

export function onBrowserAnnotation(
  handler: (e: BrowserAnnotationEvent) => void,
): Promise<() => void> {
  return subscribe("browser:annotation", handler);
}

export function onBrowserShot(handler: (e: BrowserShotEvent) => void): Promise<() => void> {
  return subscribe("browser:shot", handler);
}
