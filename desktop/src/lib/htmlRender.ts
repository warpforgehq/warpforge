/**
 * The host side of agent HTML renders (ADR 0025): the theme a page is handed,
 * the messages it exchanges with its frame, and where the desktop serves it.
 * The page side is `crates/warpforge-protocol/src/html_render/bootstrap.js`.
 */
import {
  HTML_RENDER_HOST_CONTEXT_CHANGED,
  HTML_RENDER_MAX_HEIGHT,
  HTML_RENDER_MIN_HEIGHT,
  HTML_RENDER_OPEN_LINK,
  HTML_RENDER_SIZE_CHANGED,
  HTML_RENDER_THEME_FRAGMENT_KEY,
} from "@/protocol";

import { IS_WIN } from "./platform";
import { getTheme, type Theme, type ThemeColors } from "./themes";

export interface HtmlRenderTheme {
  appearance: "light" | "dark";
  variables: Record<string, string>;
}

/** Every variable a page may style against; the `render_html` tool description lists the same. */
export const HTML_RENDER_THEME_VARIABLES = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--success",
  "--warning",
  "--info",
  "--code-background",
  "--code-foreground",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--chart-6",
  "--radius",
  "--font-sans",
  "--font-mono",
] as const;

/** Categorical series after the theme's primary; themes have no chart palette of their own. */
const CHART_SERIES = {
  light: ["#0d9488", "#d97706", "#9333ea", "#e11d48", "#65a30d"],
  dark: ["#2dd4bf", "#fbbf24", "#c084fc", "#fb7185", "#a3e635"],
} as const;

const SAME_NAME = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "destructive-foreground",
  "border",
  "input",
  "ring",
] as const satisfies readonly (keyof ThemeColors)[];

/**
 * The variables a page gets for an app theme.
 * @param theme the app theme
 * @returns the appearance and CSS variables handed to the page
 */
export function htmlRenderTheme(theme: Theme): HtmlRenderTheme {
  const c = theme.colors;
  const hsl = (triplet: string) => `hsl(${triplet})`;
  const variables: Record<string, string> = {};
  for (const name of SAME_NAME) variables[`--${name}`] = hsl(c[name]);
  Object.assign(variables, {
    "--success": hsl(c.ok),
    "--warning": hsl(c.warn),
    "--info": hsl(c.info),
    "--code-background": hsl(c["deep-surface"]),
    "--code-foreground": hsl(c.foreground),
    "--chart-1": hsl(c.primary),
    "--radius": "0.375rem",
    "--font-sans": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    "--font-mono": '"SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
  });
  CHART_SERIES[theme.mode].forEach((color, index) => {
    variables[`--chart-${index + 2}`] = color;
  });
  return { appearance: theme.mode, variables };
}

/**
 * The app theme to preview a page in.
 * @param currentId the app's theme id
 * @param appearance the appearance asked for, if any
 * @returns the current theme when it matches, else the default theme of that appearance
 */
export function themeForAppearance(currentId: string, appearance?: "light" | "dark"): Theme {
  const current = getTheme(currentId);
  if (!appearance || current.mode === appearance) return current;
  return getTheme(appearance === "dark" ? "forge" : "paper");
}

/** URL fragment that hands a page its theme before first paint. */
export function htmlRenderThemeFragment(theme: HtmlRenderTheme): string {
  return `#${HTML_RENDER_THEME_FRAGMENT_KEY}=${encodeURIComponent(JSON.stringify(theme))}`;
}

/** The notification posted into a mounted page when the theme changes. */
export function htmlRenderThemeMessage(theme: HtmlRenderTheme) {
  return {
    jsonrpc: "2.0",
    method: HTML_RENDER_HOST_CONTEXT_CHANGED,
    params: { theme: theme.appearance, styles: { variables: theme.variables } },
  } as const;
}

function record(data: unknown): Record<string, unknown> | undefined {
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : undefined;
}

/** The content height in a page's `size-changed` notification. */
export function readContentHeight(data: unknown): number | undefined {
  const message = record(data);
  if (message?.jsonrpc !== "2.0" || message.method !== HTML_RENDER_SIZE_CHANGED) return undefined;
  const height = record(message.params)?.height;
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : undefined;
}

/** A page's `open-link` request, if `data` is one with an http(s) URL. */
export function readLinkRequest(data: unknown): { id: string | number; url: string } | undefined {
  const message = record(data);
  if (message?.jsonrpc !== "2.0" || message.method !== HTML_RENDER_OPEN_LINK) return undefined;
  const { id } = message;
  if (typeof id !== "string" && typeof id !== "number") return undefined;
  const url = record(message.params)?.url;
  return typeof url === "string" && /^https?:\/\//i.test(url) ? { id, url } : undefined;
}

/** The empty result answering a page's request. */
export function htmlRenderResult(id: string | number) {
  return { jsonrpc: "2.0", id, result: {} } as const;
}

/**
 * The frame height: the agent's height until the page reports its own, then
 * the page's. A frame shorter than its page would scroll inside the chat and
 * take the reader's scroll.
 * @param height the agent's height
 * @param contentHeight the page's reported height, once known
 * @returns the clamped height in CSS pixels
 */
export function htmlRenderFrameHeight(height: number, contentHeight?: number): number {
  const wanted = Math.round(contentHeight ?? height);
  return Math.min(HTML_RENDER_MAX_HEIGHT, Math.max(HTML_RENDER_MIN_HEIGHT, wanted));
}

/**
 * Where the desktop serves a stored page. Windows webviews reach custom
 * schemes as `http://<scheme>.localhost`.
 * @param taskId the task the page belongs to
 * @param renderId the page
 * @returns the page's URL, without a fragment
 */
export function renderUrl(taskId: string, renderId: string): string {
  const path = `${encodeURIComponent(taskId)}/${encodeURIComponent(renderId)}.html`;
  return IS_WIN ? `http://wf-render.localhost/${path}` : `wf-render://localhost/${path}`;
}
