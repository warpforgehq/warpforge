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
          scope: typeof call.scope === "string" ? call.scope : undefined,
          headings: Boolean(call.headings),
        });
        break;
      case "click":
        out = click(call.ref as string);
        break;
      case "type":
        out = type(call.ref as string, String(call.text ?? ""), Boolean(call.submit));
        break;
      case "console":
        out = { messages: consoleMessages ? consoleMessages() : [] };
        break;
      case "press":
        out = press(
          typeof call.ref === "string" ? call.ref : undefined,
          String(call.key ?? ""),
        );
        break;
      case "scroll":
        out = scroll({
          ...(typeof call.ref === "string" ? { ref: call.ref } : {}),
          ...(typeof call.to === "string" ? { to: call.to } : {}),
          ...(typeof call.pages === "number" ? { pages: call.pages } : {}),
        });
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
        out = { ...checkWait({
          ...(typeof call.text === "string" ? { text: call.text } : {}),
          ...(typeof call.gone === "string" ? { gone: call.gone } : {}),
          ...(typeof call.ref_gone === "string" ? { ref_gone: call.ref_gone } : {}),
        }) };
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
