# 0025 — Agents show HTML pages inline, framed and served by the desktop

**Status:** accepted (2026-10-07)

## Context

A chart, a table or a mockup says more than prose, and agents can write one
as a self-contained HTML page. The reference implementation (T3 Code's
`html_render`) stores the page, shows it in a sandboxed iframe in the
thread, and measures and previews it in a headless Chromium on the server.
Warpforge's daemon has no browser, while the desktop app already owns
WebKit views and their capture (`browser_capture.rs`, ADR 0021).

The desktop is a Tauri app, and the agent's HTML is untrusted.

## Decisions

**One bootstrap, injected by the daemon.** `render_html` validates the page
(512 KB, title 200 characters, height clamped to 80–2000), puts
`crates/warpforge-protocol/src/html_render/bootstrap.js` and `base.css` at the
start of its `<head>` (`daemon/html_render/inject.rs`), writes it to
`~/.warpforge/renders/<task>/<render>.html` and records a
`SessionUpdate::HtmlRender` in the task's transcript. The page and its host
speak the MCP Apps JSON-RPC over `postMessage`: theme in
(`host-context-changed`, first one in the `#wf-theme=` fragment), content
height out (`size-changed`), link clicks out (`open-link`). Deleting a task
deletes its directory.

**The desktop serves pages from its own scheme.** `wf-render://` reads the
file the daemon wrote (the two always share a machine) and sends the page's
own CSP: no connections, inline and `https:` scripts, styles, images and
fonts (`desktop/src-tauri/src/html_render`). The app CSP allows framing
nothing else (`frame-src wf-render:`).

**Pages are only ever sandboxed iframes.** `HtmlRenderFrame` frames a page
with `sandbox="allow-scripts allow-forms"`: an opaque origin that cannot
read the app's window. The scheme handler serves a render only to the `main`
webview and a preview page only to its own `html-preview:<id>` webview, so a
browser tab or another webview cannot load one.

**The invoke key is what keeps a page from app commands.** WebKit gives every
frame `window.webkit.messageHandlers.ipc`, and wry forwards a subframe's
message with that frame's URL. Tauri counts `wf-render:` as a local origin,
and app commands have no ACL manifest, so a call with the right key would
run. Tauri checks the key before anything else and drops a message without
it; the custom-protocol IPC path needs it as a header, which a form or image
cannot send. The key is 128 random bits held in a closure of a main-frame-only
script, and an opaque-origin frame cannot read the main frame.

**Previews run in the desktop.** `render_preview` sends the injected page to
the app that registered the `browser` capability. It frames the page in a
`data:` host page inside an incognito child webview placed outside the
window's visible area, waits for the reported height, sizes the view to it
and takes a `WKWebView` snapshot (macOS only). No app connected is an error
that says `render_html` still works.

**The frame fits the page.** The agent's height is the reservation until the
page reports its own; then the frame takes the page's height, up to 2000. A
frame shorter than its page scrolls inside the chat and traps the reader's
scroll, and without a server-side measurement there is no way to tell an
intended scroll cap from an underestimate.

**Links open in the in-app browser**, in a new tab of the task's project,
only when the frame has focus and the user has just interacted.

### Rejected

- **A headless Chromium in the daemon.** A large download for measuring and
  screenshots the desktop's WebKit already does, in the engine users see.
- **Loading a page as a webview's main frame** (a preview window navigated to
  `wf-render://`). Tauri treats every registered scheme as a local origin, and
  local origins may call every app command — there is no ACL manifest.
- **A new client capability for previews.** `client.register` replaces a
  connection's whole capability list, so a second capability would unregister
  the browser.
- **`allow-same-origin`** on the frame. With it the page shares the app's
  origin and can reach `window.parent`, `__TAURI_INTERNALS__` and the invoke key.
- **Blocking `wf-render:` in a global navigation hook.** wry's navigation
  callback sees subframe loads with only a URL, so it would block the chat's
  own frames as well.

## Invariants

1. **Never `allow-same-origin` on a render or preview iframe.**
   (`components/HtmlRenderFrame.tsx`, `src-tauri/src/html_render/preview.rs`)
2. **Agent HTML is never a webview's main frame.** A custom-scheme main frame
   is local to Tauri and gets every app command.
3. **No `remote` capability, and no capability beyond `windows: ["main"]`.**
   (`capabilities/default.json`, asserted in `html_render/mod.rs` tests) A
   remote capability would expose commands to the preview's `data:` host.
4. **The scheme serves renders only to `main` and previews only to their own
   `html-preview:<id>` label.** (`html_render/mod.rs` `route`)
5. **Deleting a task removes `~/.warpforge/renders/<task>`.**
   (`actor/commands/task.rs` `DeleteTask`)
6. **The preview's `data:` host page carries no inline script and no `#`,
   `?` or `%`.** Tauri adds the app CSP to `data:` pages, which blocks inline
   scripts, and rewrites the URL without escaping those characters, so a `#`
   cuts the page off. A main-frame-only initialization script creates the
   sandboxed iframe and sets its URL. (`html_render/preview.rs`, tested
   against the same rewrite)
7. **Nothing reaches a render or preview frame that carries the invoke key or
   `__TAURI_INTERNALS__`.** No message posted into the frame, no
   for-all-frames initialization script, no `allow-same-origin`. The key is the
   only gate between a page and every app command.
   (`components/HtmlRenderFrame.tsx`, `html_render/preview.rs`)

### Manual check

What the tests cannot prove is WebKit's behaviour. In a release build, open a
task with a render, attach Web Inspector, pick the render's frame as the
context and confirm `window.__TAURI_INTERNALS__` is `undefined`,
`window.parent.document` throws, and
`window.webkit.messageHandlers.ipc.postMessage("x")` changes nothing (the
app log shows an invoke-key mismatch or nothing). That `ipc` handler exists
in the frame is expected.
