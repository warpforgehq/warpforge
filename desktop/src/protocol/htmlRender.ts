// ── Agent HTML renders (mirrors crates/warpforge-protocol/src/html_render) ──

export const HTML_RENDER_MIN_HEIGHT = 80;
export const HTML_RENDER_MAX_HEIGHT = 2000;
export const HTML_RENDER_MAX_TITLE_CHARS = 200;
/** The chat's reply column, and the preview's default width. */
export const HTML_PREVIEW_DEFAULT_WIDTH = 720;

/** Host → page: the theme changed. */
export const HTML_RENDER_HOST_CONTEXT_CHANGED = "ui/notifications/host-context-changed";
/** Page → host: the page's content height changed. */
export const HTML_RENDER_SIZE_CHANGED = "ui/notifications/size-changed";
/** Page → host: the reader clicked an http(s) link. */
export const HTML_RENDER_OPEN_LINK = "ui/open-link";
/** Page → preview host: a console warning or error. */
export const HTML_RENDER_LOG_MESSAGE = "notifications/message";
/** URL fragment key that carries the first theme into the page. */
export const HTML_RENDER_THEME_FRAGMENT_KEY = "wf-theme";
