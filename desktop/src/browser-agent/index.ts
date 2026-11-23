// Injected before page scripts; each call carries allowed origins and is refused unless
// this document is on one (the native URL moves when a load starts, while the old document
// is still scripted). Frozen entry point, builtins captured at init, so capture at top level.
import { click, type } from "./actions";
import { consoleMessages, loc, stringify } from "./builtins";
import { markPage, takeChanges } from "./changes";
import { press } from "./keys";
import { allowed } from "./origin";
import { scroll, scrollStatus } from "./scroll";
import { snapshot } from "./snapshot";
import type { AgentCall, AgentResult } from "./types";
import { checkWait } from "./wait";

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function run(call: AgentCall | null | undefined): string {
  const origin = loc.origin;
  if (!call || (call.action !== "origin" && !allowed(call.allowed, origin))) {
    return stringify({ blocked: origin, origin, url: loc.href });
  }
  let out: AgentResult;
  try {
    switch (call.action) {
      case "origin":
      case "check":
        out = {};
        break;
      case "snapshot":
        out = snapshot({
          interactive: Boolean(call.interactive),
          scope: str(call.scope),
          headings: Boolean(call.headings),
        });
        break;
      case "click":
        out = click(String(call.ref ?? ""));
        break;
      case "type":
        out = type(String(call.ref ?? ""), String(call.text ?? ""), Boolean(call.submit));
        break;
      case "console":
        out = { messages: consoleMessages ? consoleMessages() : [] };
        break;
      case "press":
        out = press(str(call.ref), String(call.key ?? ""));
        break;
      case "scroll":
        out = scroll({ ref: str(call.ref), to: str(call.to), pages: num(call.pages) });
        break;
      case "scroll_status":
        out = { scroll: scrollStatus() };
        break;
      case "mark":
        markPage();
        out = {};
        break;
      case "changes":
        out = { changes: takeChanges() };
        break;
      case "check_wait":
        out = checkWait({
          text: str(call.text),
          gone: str(call.gone),
          ref_gone: str(call.ref_gone),
        });
        break;
      default:
        out = { error: `unknown browser action ${call && call.action}` };
    }
  } catch (e) {
    out = {
      error: `The page script failed: ${e instanceof Error && e.message ? e.message : String(e)}`,
    };
  }
  out.origin = origin;
  out.url = loc.href;
  out.title = document.title;
  return stringify(out);
}

if (!window.__wfAgent) {
  Object.defineProperty(window, "__wfAgent", {
    value: Object.freeze(run),
    writable: false,
    configurable: false,
    enumerable: false,
  });
}
