/** Settle windows and polling live here so the page script stays synchronous. */
import type { BrowserAction } from "../../../protocol";
import { browser as nativeBrowser, NO_TAB } from "./browserClient";

export const SETTLE_MS = 300;
export const SCROLL_SETTLE_MS = 400;
export const WAIT_POLL_MS = 150;
export const WAIT_DEFAULT_MS = 5_000;
export const WAIT_MAX_MS = 30_000;

type Result = Record<string, unknown>;

function asObject(value: unknown): Result {
  return value && typeof value === "object" ? (value as Result) : {};
}

function lines(result: Result, key: string): string[] {
  const value = result[key];
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === "string") : [];
}

function merge(first: string[], second: string[]): string[] {
  const out = [...first];
  for (const line of second) if (!out.includes(line)) out.push(line);
  return out;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function urlOf(result: Result): string {
  return typeof result.url === "string" ? result.url : "";
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("cancelled"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("cancelled"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function call(
  tabId: string,
  request: Record<string, unknown>,
  allowed: string[],
): Promise<Result> {
  return asObject(await nativeBrowser.agentCall(tabId, request, allowed));
}

/**
 * Whether an error means the agent's tab no longer exists.
 * @param error - Whatever a browser call rejected with.
 * @returns True for the closed-tab error.
 */
export function isNoTab(error: unknown): boolean {
  return String(error instanceof Error ? error.message : error) === NO_TAB;
}

async function tryCall(
  tabId: string,
  request: Record<string, unknown>,
  allowed: string[],
): Promise<Result | null> {
  try {
    return await call(tabId, request, allowed);
  } catch (error) {
    if (isNoTab(error)) throw error;
    return null;
  }
}

/** Wait a settle window, then merge what changed since the action began. A
 *  page that navigated meanwhile has no state to compare, so say where it went. */
async function settle(
  tabId: string,
  allowed: string[],
  acted: Result,
  immediate: string[],
  signal: AbortSignal,
): Promise<string[]> {
  await delay(SETTLE_MS, signal);
  const after = await tryCall(tabId, { action: "changes" }, allowed);
  if (!after || after.blocked) return immediate;
  if (urlOf(after) !== urlOf(acted)) {
    const title = typeof after.title === "string" && after.title ? ` ${JSON.stringify(after.title)}` : "";
    return merge(immediate, [`navigated → ${urlOf(after)}${title}`]);
  }
  return merge(immediate, lines(after, "changes"));
}

async function runScroll(
  tabId: string,
  action: Extract<BrowserAction, { action: "scroll" }>,
  allowed: string[],
  signal: AbortSignal,
): Promise<Result> {
  const result = await call(tabId, { ...action }, allowed);
  if (result.blocked) return result;
  await delay(SCROLL_SETTLE_MS, signal);
  const status = await tryCall(tabId, { action: "scroll_status" }, allowed);
  const after = await tryCall(tabId, { action: "changes" }, allowed);
  const same = status && !status.blocked && urlOf(status) === urlOf(result);
  const scroll = same ? asObject(status.scroll) : {};
  return {
    ...result,
    changes: merge(lines(result, "changes"), same && after ? lines(after, "changes") : []),
    ...(Object.keys(scroll).length > 0 ? { scroll } : {}),
  };
}

async function runWait(
  tabId: string,
  action: Extract<BrowserAction, { action: "wait" }>,
  allowed: string[],
  signal: AbortSignal,
): Promise<Result> {
  const timeout = Math.min(WAIT_MAX_MS, Math.max(0, action.timeout_ms ?? WAIT_DEFAULT_MS));
  const started = Date.now();
  await call(tabId, { action: "mark" }, allowed);
  const condition = { text: action.text, gone: action.gone, ref_gone: action.ref_gone };
  let waited = 0;
  let met = false;
  let detail: Result = {};
  for (;;) {
    const check = await tryCall(tabId, { action: "check_wait", ...condition }, allowed);
    if (check?.met === true) {
      met = true;
      detail = check;
      break;
    }
    if (waited >= timeout) break;
    const step = Math.min(WAIT_POLL_MS, timeout - waited);
    await delay(step, signal);
    waited += step;
  }
  const after = await tryCall(tabId, { action: "changes" }, allowed);
  return {
    ...after,
    met,
    elapsedMs: Date.now() - started,
    line: str(detail.line),
    ref: str(detail.ref),
  };
}

/**
 * Run one non-navigate action, adding settle or polling where it needs time.
 * @param tabId - The agent tab to act in.
 * @param action - The action to run.
 * @param allowed - Origins the page script may act on.
 * @param signal - Aborts the settle and polling delays.
 * @returns The page script's result with the changes merged in.
 */
export async function runBrowserAction(
  tabId: string,
  action: Exclude<BrowserAction, { action: "navigate" } | { action: "screenshot" }>,
  allowed: string[],
  signal: AbortSignal,
): Promise<Result> {
  if (action.action === "scroll") return runScroll(tabId, action, allowed, signal);
  if (action.action === "wait") return runWait(tabId, action, allowed, signal);
  const result = await call(tabId, action, allowed);
  if (!["click", "type", "press"].includes(action.action) || result.blocked) return result;
  const immediate = lines(result, "changes");
  result.changes = await settle(tabId, allowed, result, immediate, signal);
  return result;
}
