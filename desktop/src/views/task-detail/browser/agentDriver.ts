/**
 * Runs the daemon's browser requests — an agent's `browser_*` tools — in the
 * project's agent tab. `browser_navigate` creates that tab on first use and
 * makes it the active tab; every later action uses it, whatever tab the user
 * switches to. The daemon decides which origins are allowed; the tab commands
 * check the page against that list before acting.
 */
import { serveClientRequests, type ClientRequestChannel } from "@/daemon/clientRequests";
import { IS_TAURI } from "@/lib/platform";

import { BROWSER_CAPABILITY, type BrowserAction, type ClientRequestBody } from "../../../protocol";
import {
  browser,
  NO_TAB,
  onBrowserState,
  onBrowserTitle,
  type BrowserStateEvent,
} from "./browserClient";
import { recordTabPage, showAgentTab } from "./browserSession";
import { runHtmlPreview } from "./htmlPreview";

/** Where a tab the agent opens sits while no pane shows it; a pane that shows
 *  it moves it into place. */
const BACKGROUND_BOUNDS = { x: 0, y: 0, width: 1280, height: 800 };
/** A same-document navigation reports no load at all. */
const START_WAIT_MS = 4_000;
const LOAD_WAIT_MS = 20_000;

const NO_PAGE =
  "The agent has no browser tab yet. Open a page with browser_navigate first; list_runtime shows the project's service URLs.";
const CLOSED =
  "The agent's browser tab was closed. Open a page with browser_navigate to get a new one.";

/** The agent's tab per project, for this app run. */
const agentTabs = new Map<string, string>();

function isNoTab(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error) === NO_TAB;
}

/** Whether the tab finished a load it started, watched from before it starts. */
async function watchLoad(
  tabId: string,
  signal: AbortSignal,
): Promise<{
  done: Promise<"loaded" | "loading" | "idle">;
  stop: () => void;
}> {
  let started = false;
  let finish: (outcome: "loaded" | "loading" | "idle") => void = () => {};
  const done = new Promise<"loaded" | "loading" | "idle">((resolve) => {
    finish = resolve;
  });
  const off = await onBrowserState((e: BrowserStateEvent) => {
    if (e.tabId !== tabId) return;
    if (e.loading) started = true;
    else if (started) finish("loaded");
  });
  const timers = [
    window.setTimeout(() => {
      if (!started) finish("idle");
    }, START_WAIT_MS),
    window.setTimeout(() => finish("loading"), LOAD_WAIT_MS),
  ];
  const abort = () => finish("loading");
  signal.addEventListener("abort", abort);
  const stop = () => {
    for (const timer of timers) window.clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    off();
  };
  return { done, stop };
}

interface PageReport {
  url?: string;
  title?: string;
  origin?: string;
}

/**
 * Load `url` in the project's agent tab, creating it out of sight when there
 * is none, and report what the tab shows afterwards — which is the old page
 * when the new one never loaded.
 */
async function navigate(project: string, url: string, signal: AbortSignal): Promise<unknown> {
  const tabId = agentTabs.get(project) ?? `${project}:${crypto.randomUUID()}`;
  const watch = await watchLoad(tabId, signal);
  try {
    try {
      await browser.navigate(tabId, url);
    } catch (error) {
      if (!isNoTab(error)) throw error;
      await browser.open(tabId, url, BACKGROUND_BOUNDS, false, true);
    }
    agentTabs.set(project, tabId);
    showAgentTab(project, { id: tabId, url });
    const outcome = await watch.done;
    const page = (await browser.agentCall(tabId, { action: "origin" }, [])) as PageReport;
    const arrived = page.url?.split("#")[0] === url.split("#")[0];
    recordTabPage(tabId, {
      ...(page.url ? { url: page.url } : {}),
      ...(page.title ? { title: page.title } : {}),
    });
    return {
      ...page,
      tab: tabId,
      requested: url,
      loading: outcome === "loading" || (outcome === "idle" && !arrived),
    };
  } finally {
    watch.stop();
  }
}

/**
 * Do what one browser request asks, in the project's agent tab, or preview an
 * agent's HTML page.
 * @param body the daemon's request
 * @param signal aborted when the daemon stops waiting
 * @returns the result the daemon hands to the agent
 */
export async function runBrowserRequest(
  body: ClientRequestBody,
  signal: AbortSignal,
): Promise<unknown> {
  if (body.kind === "html_preview") return runHtmlPreview(body);
  const { action, allowed_origins: allowed, project } = body;
  if (action.action === "navigate") return navigate(project, action.url, signal);
  const tabId = agentTabs.get(project);
  if (!tabId) throw new Error(NO_PAGE);
  const call: Exclude<BrowserAction, { action: "navigate" }> = action;
  const run =
    call.action === "screenshot"
      ? browser.agentScreenshot(tabId, allowed)
      : browser.agentCall(tabId, call, allowed);
  return run.catch((error: unknown) => {
    if (!isNoTab(error)) throw error;
    agentTabs.delete(project);
    return Promise.reject(new Error(CLOSED));
  });
}

/** Forget every agent tab, for tests. */
export function resetAgentTabs(): void {
  agentTabs.clear();
}

/**
 * Serve the agents' browser tools from this app for as long as it runs, and
 * keep remembered tabs following pages that change while no pane shows them.
 * @param channel the daemon client
 */
export function installBrowserAgent(channel: ClientRequestChannel): void {
  if (!IS_TAURI) return;
  void onBrowserState(({ tabId, url }) => recordTabPage(tabId, { url }));
  void onBrowserTitle(({ tabId, title }) => {
    if (title) recordTabPage(tabId, { title });
  });
  serveClientRequests(channel, BROWSER_CAPABILITY, runBrowserRequest);
}
