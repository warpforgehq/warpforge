use serde_json::{json, Value};
use warpforge_protocol::html_render::{
    DEFAULT_PREVIEW_WIDTH, MAX_HEIGHT, MAX_PREVIEW_WIDTH, MAX_TITLE_CHARS, MIN_HEIGHT,
    MIN_PREVIEW_WIDTH,
};

const PAGE_RULES: &str = "Write one complete, self-contained HTML document with inline <style> \
    and <script>. Scripts, stylesheets, fonts and images from https URLs (a CDN chart library, \
    say) load as-is; data: URLs work for images and fonts. The page has no other network access: no fetch, XHR \
    or WebSocket, and no local files.";

const LAYOUT_GUIDE: &str = "Layout: the frame is borderless on the chat's own background and as \
    wide as the reply column (720px up to well over 1000px; it changes with the window, so \
    preview at more than one width). Leave html, body and the \
    outermost element without a background color. Use a fluid width with no horizontal padding \
    on the outermost element, and no outer card, border or banner title: the page is part of \
    your reply. A box that needs its own background (a mock of one screen, a panel that must \
    stand apart) gets at least 16px of padding on every side and var(--radius) corners. Give \
    charts fixed pixel heights. Never stretch an SVG with preserveAspectRatio=\"none\": it \
    distorts text. Draw it at the container's clientWidth and redraw on resize. Let content set the page's height: no 100vh, and no height:100% \
    on html or body, since the frame grows to fit the page.";

const THEME_GUIDE: &str = "Theme: Warpforge sets its theme as CSS custom properties on :root, \
    and they follow the user's theme and light/dark mode live: --background (identical to the \
    chat around the frame), --foreground, --card, --card-foreground, --popover, \
    --popover-foreground, --primary, --primary-foreground (solid buttons, the brand accent), \
    --secondary, --secondary-foreground, --muted, --muted-foreground, --accent, \
    --accent-foreground (hover surfaces), --destructive, --destructive-foreground, --border, \
    --input, --ring, --success, --warning, --info, --code-background, --code-foreground, \
    --chart-1 … --chart-6 (categorical series for charts), --radius, --font-sans, --font-mono. \
    The base stylesheet sets html background, color and font from these, body margin to 0, and \
    hides the scrollbar; your own CSS overrides it.";

pub(super) fn defs() -> Vec<Value> {
    let html = json!({
        "type": "string",
        "description": "A complete, self-contained HTML document, at most 512 KB."
    });
    vec![
        json!({
            "name": "render_html",
            "description": format!(
                "Show a finished HTML page (chart, table, diagram, clickable mockup) inline in \
                 this task's chat, above your final reply; call it before writing that reply. \
                 The user already sees the page, so the reply must not announce it, say where \
                 it is, or restate it: add only what the page doesn't say. Check the page with \
                 render_preview first. The frame starts at `height` and then fits the page's \
                 own height. {PAGE_RULES} {LAYOUT_GUIDE} {THEME_GUIDE}"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "html": html,
                    "title": {
                        "type": "string",
                        "description": format!("Short name for the page, at most {MAX_TITLE_CHARS} characters.")
                    },
                    "height": {
                        "type": "integer",
                        "description": format!(
                            "Initial frame height in CSS pixels, {MIN_HEIGHT}-{MAX_HEIGHT}; use render_preview's contentHeight."
                        )
                    }
                },
                "required": ["html", "title", "height"]
            }
        }),
        json!({
            "name": "render_preview",
            "description": format!(
                "Load an HTML page the way render_html shows it — same theme variables, base \
                 stylesheet and layout — and get back a PNG screenshot, contentHeight (the \
                 height the page needs at this width) and its console warnings and errors, \
                 uncaught ones included. Use it to check and fix a page before render_html; it \
                 shows nothing to the user. Needs the Warpforge desktop app (macOS). {PAGE_RULES}"
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "html": html,
                    "width": {
                        "type": "integer",
                        "description": format!(
                            "Viewport width in CSS pixels, {MIN_PREVIEW_WIDTH}-{MAX_PREVIEW_WIDTH}. Defaults to {DEFAULT_PREVIEW_WIDTH}, the reply column; use about 390 to check phones."
                        )
                    },
                    "appearance": {
                        "type": "string",
                        "enum": ["light", "dark"],
                        "description": "Theme to preview. Defaults to the app's current appearance."
                    }
                },
                "required": ["html"]
            }
        }),
    ]
}
