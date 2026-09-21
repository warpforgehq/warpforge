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

export const browser = {
  open(tabId: string, url: string, bounds: BrowserBounds): Promise<void> {
    return call("browser_open", { tabId, url, ...bounds });
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
    return call("browser_set_visible", { tabId, visible });
  },
  close(tabId: string): Promise<void> {
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
