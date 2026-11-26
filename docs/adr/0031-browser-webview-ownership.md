# 0031 — Browser webview ownership under wry 2.12 and agent focus restore

**Status:** accepted (2026-11-26)

## Context

Two behaviors of the in-app browser tabs depend on reaching past Tauri into the
native WKWebView: reload-from-origin (a dev server's cached response must not
serve stale content) and the agent page actions (ADR 0021), which run page
scripts in a hidden tab. Both go through `Webview::with_webview`.

The wry upgrade moved tauri-runtime-wry from 2.11 to 2.12, which silently
changed what `with_webview` hands over on macOS: 2.11 passed +1-retained
pointers, 2.12 passes borrowed ones (`Retained::as_ptr`). The 2.11-era code
"adopted" all three pointers (`inner`, the controller, `ns_window`) with
`Retained::from_raw`, which on 2.12 over-released the live NSWindow: production
0.32.1 aborted in `-[NSWindow dealloc]` on every reload or capture.

Separately, a page script that focuses an element makes WebKit promote the
hidden tab's webview to the window's first responder, so the user's typing
lands in the agent's page.

## Decisions

**Retain only the WKWebView; never release the controller or ns_window.**
`retain_wk_webview` in `browser.rs` retains `platform.inner()` and leaves the
other pointers alone. Every native reach-through (reload, capture) goes through
it. Re-check `WithWebview` pointer ownership on every Tauri/wry upgrade.

**Agent page actions restore the window's first responder.** `focus_guard.rs`
holds the pre-call first responder as a raw pointer in an atomic slot that
crosses an await (main-thread-only access, `Release` store / `Acquire` swap)
and hands focus back only when the call actually moved it into the agent's
tab and the remembered responder is still in the window.

### Rejected

- **Adopting (from_raw) all three pointers**, the 2.11 approach. On borrowed
  pointers it over-releases the NSWindow and crashes; the retain is the
  minimal correct ownership for 2.12.
- **Leaving focus in the agent's tab.** The tab is hidden, so the user cannot
  see where their typing goes; nothing short of restoring the previous
  responder fixes it.

## Invariants

1. **`with_webview` pointers are borrowed; retain, never adopt.**
   (`browser.rs`, `browser_capture.rs`) No `from_raw` on anything
   `PlatformWebview` hands over; only `retain_wk_webview`'s retained
   `inner()` may be released, and only by dropping the `Retained`.
2. **A Tauri or wry upgrade re-checks `WithWebview` ownership** before the
   browser tab is used (`browser.rs`).
3. **Every agent page action runs under a focus guard** that restores the
   window's previous first responder (`focus_guard.rs`); the guard's pointer
   is touched only on the main thread and only through the atomic slot.
