# 0021 — Agents drive the in-app browser through a daemon → client request

**Status:** accepted (2026-09-28); amended 2026-09-28 (the agent's own tab, the
document-origin check), 2026-11-22 (TypeScript source, bundled page script,
narrowed snapshots)

## Context

Agents could read an element the user picked in the in-app browser, but not
act on a page. WKWebView has no DevTools protocol, and the page views are
native child webviews owned by the desktop app, not by the daemon the agent's
MCP bridge talks to. Until now every exchange was client → daemon; nothing let
the daemon ask a client to do something and wait for the answer.

The browser also has one web session for the whole app (the user's logins,
kept across restarts), so an agent acting in it acts as the signed-in user.

## Decisions

**A general daemon → client request channel** (`daemon/server/client_hub.rs`).
A connection offers capabilities with `client.register`. The daemon sends a
`client.request` event (request id, timeout, typed body) to that connection
alone, never broadcast, and waits for its `client.reply`. When several
connections registered a capability, the newest registration answers; nothing
falls back to an older one after a failure, so an action never lands in a
second app's browser. No registration is an immediate error. A disconnect
fails that connection's requests at once. A timeout, or a caller that stops
waiting, sends `client.requestCancelled`, and a late reply is refused. Only the
connection a request was sent to may answer it. The desktop registers `browser`
on every reconnect, only in the Tauri app (`desktop/src/daemon/clientRequests.ts`).

**Browser actions are DOM scripting, not a protocol.** Two initialization
scripts run in every tab: `browser_console.js` keeps console messages from the
start of the load, and `browser_agent.js` outlines the page with refs held in
a `WeakMap` (no DOM attributes are written, so the page is not changed by
being read) and fires the event sequence a pointer or keyboard would. Values are set through the
prototype setter plus `input`/`change`, which is what React's controlled
inputs observe. Screenshots are `WKWebView.takeSnapshot` (macOS only).

**The agent acts in a tab of its own** (`desktop/.../browser/agentDriver.ts`).
The first `browser_navigate` in a project creates it — hidden when no pane
shows it — adds it to the tab strip and makes it active; every later action
uses that tab, whichever tab the user switches to. Other actions before a
navigate, or after the user closed the tab, return an error naming
`browser_navigate`. The user's view is never switched to the browser.

**The origin gate is the daemon's list, checked on the page the action runs in.** The
daemon allows every loopback spelling of the ports the project's services and
port-forwards were allocated, plus origins the user allowed "always" for the
task (daemon memory, `browser/origins.rs`). `browser_navigate` checks the
target before anything loads. Every other action sends the list with the
request, and it is checked twice on the desktop before anything runs: against
the webview's native URL, and inside the script against the origin of the
document it is running in. Either failing answers `{ blocked: origin }`. The
daemon checks again that the result names an allowed document origin, and
treats one that does not, or names none, as refused. Anything outside
the list raises a permission prompt on the calling task's chat through the
agent permission flow (`actor/user_ask.rs`): same `PermissionRequest` update,
same `session.permission` answer, routed back to the daemon instead of to the
agent. It carries `browser_origin`, so toasts and native banners offer only
Review for it, never a one-click approve. It waits five minutes, then is
withdrawn as cancelled.

**The page script is TypeScript modules with a committed bundle.** Its source
lives in `desktop/src/browser-agent/`, split by topic. `bun run
build:agent-script` (`bun build … --format=iife --target=browser`) writes the
unchanged path `desktop/src-tauri/src/browser_agent.js`, which stays committed
and is what `include_str!` embeds. There is no build step in `tauri dev`, cargo
or CI; a vitest drift test rebuilds with the same script and fails when the
committed bundle is stale. Bun is the only tool added — no bundler dependency.
The output is one IIFE, so the builtins it captures are still read before page
scripts, and the entry point is still frozen and non-configurable. Hand-editing
one 500-line script was the fragile part; a reviewed generated file is cheaper
than concatenating modules by hand.

**A snapshot can be narrowed.** `browser_snapshot` takes `interactive` (outline
only controls, headings and group lines) and `scope` (a ref, outlining just that
subtree). Refs come from the same `WeakMap`, so an element keeps its ref in every
mode, and a scoped walk mints no refs outside the scope. A heading's ref scopes
to its section: the heading and the siblings that follow it up to the next
heading of the same or a higher level, climbing a wrapper that holds only that
heading. The full outline stays the way to read page text. Status and alert
messages (`role`, `aria-live`, `<output>`) are printed in every mode, and a
scoped snapshot keeps text up to 1000 characters instead of 160, but neither
changes any reference. `browser_click` and `browser_type` also report what
changed synchronously — new or changed live regions, dialogs and menus opened
or closed, the URL — and inlines the outline of a dialog or popup that opened,
so an action rarely needs a snapshot to see its result; anything that arrives
later is not in it.

**Actions that need time are polled by the desktop driver.** The page script
stays synchronous: `evaluateJavaScript` still answers with one value. `click`,
`type` and `press` report their immediate changes, then the driver waits a
300 ms settle window and asks the script for anything new since the action
began, deduping lines already reported; if the page navigated meanwhile it
keeps only the immediate report. `browser_scroll` settles for 400 ms so scroll
events and lazy lists can run, then reads the position and a count of new
interactive elements. `browser_wait` marks the page at the start and polls a
`check_wait` script action every 150 ms for at most 30 seconds (5 seconds by
default); a timeout is a normal result, and every poll is origin-gated like
any other action. The script keeps one `pending` page state for `mark` and
`changes`, so an action's own capture is what the settle compares against.

**What the agent reads is wrapped as untrusted** (`mcp/untrusted.rs`): a
`<browser_page>` block that says it is data, with a zero-width space after
every `<` from the page — the scheme `formatAnnotation.ts` uses for picks.

### Rejected

- **CDP or WebDriver.** WKWebView exposes neither to an embedding app.
- **Broadcasting the request and taking the first answer.** Two apps on one
  daemon (a `tauri dev` next to the installed app) would race to act.
- **Checking the origin only in the page script.** The page can patch the
  builtins the script calls in its own world. The script's check is the one
  that sees the right document; the native check and the daemon's re-check
  are what a patched page cannot get past.
- **Trusting `WKWebView.URL` alone.** It moves to a new address as soon as a
  load starts, and stays there while that load hangs, while the old document
  is still the one scripts run in. In the first live test, after a navigation
  to a localhost service that did not load, snapshot, type and screenshot of
  the Google page still in the tab went through with no prompt; the native
  URL was the only check between them and the page.
- **Acting in the user's active tab.** Actions followed whichever tab was
  active when each one ran, read from pane state that more than one mounted
  pane writes, so a navigate and the snapshot after it could reach different
  pages.
- **Opening the browser pane for the agent.** It takes the user's screen away
  mid-task; a background tab is adopted by the pane anyway.
- **Marking elements with `data-*` refs.** It writes to the page's DOM, which
  frameworks re-render or diff against.

## Invariants

1. **A client request goes to one connection.** (`client_hub.rs`) Never
   through the broadcast bus, and only its recipient may reply.
2. **No page action runs unless the document it runs in is on an allowed
   origin.** (`browser_agent.js` `run`, `browser_agent.rs` `gate`/`checked`)
   The native URL check alone is not enough; only the `origin` report is
   exempt, and the daemon keeps the title of a page it reports from an
   unapproved origin away from the agent.
3. **`browser_navigate` is gated on its target, before the load.**
   (`daemon/browser/mod.rs`) Checking the page after it loaded has already
   sent the user's cookies to it.
4. **A daemon prompt's answer never reaches the agent.**
   (`actor/commands/session.rs`) The agent did not ask; forwarding it would
   answer a request the agent does not have.
5. **Everything page-derived stays inside the untrusted block**, URL and title
   included. (`mcp/handle/browser.rs`)
6. **Every action targets the agent's tab.** (`agentDriver.ts`) Resolving the
   tab from pane state per action is what split navigate and snapshot.
