import { LIVE_CAP } from "./constants";
import { clean, liveKind, quote, rendered } from "./outline";
import { existingRef, lookup, refFor } from "./refs";

const LIVE_SELECTOR = "[role=status],[role=alert],[role=log],[aria-live],output";

export interface WaitCondition {
  text?: string;
  gone?: string;
  ref_gone?: string;
}

export interface WaitCheck {
  met: boolean;
  line?: string;
  ref?: string;
}

function textOf(el: Element): string {
  const inner = (el as HTMLElement).innerText;
  return typeof inner === "string" ? inner : el.textContent || "";
}

function visibleText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  if (!rendered(el)) return "";
  let text = "";
  for (const child of Array.from(el.childNodes)) text += visibleText(child);
  return text;
}

function bodyText(): string {
  const body = document.body;
  if (!body) return "";
  return shownText(body);
}

/** Text as the user sees it, falling back to a render-aware walk where the
 *  engine has no innerText (it already skips display:none). */
function shownText(el: Element): string {
  const inner = (el as HTMLElement).innerText;
  return typeof inner === "string" ? inner : visibleText(el);
}

function liveWith(text: string): Element | null {
  for (const el of Array.from(document.querySelectorAll(LIVE_SELECTOR))) {
    if (liveKind(el) && rendered(el) && textOf(el).includes(text)) return el;
  }
  return null;
}

function elementWith(text: string): Element | null {
  if (!document.body) return null;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue || !node.nodeValue.includes(text)) continue;
    const parent = node.parentElement;
    if (parent && rendered(parent)) return parent;
  }
  return null;
}

function depthOf(el: Element): number {
  let depth = 0;
  for (let node: Element | null = el; node; node = node.parentElement) depth += 1;
  return depth;
}

/** The deepest rendered element whose shown text holds `text`, so text split
 *  across inline elements still yields the element that carries all of it. */
function smallestWith(text: string): Element | null {
  const body = document.body;
  if (!body) return null;
  let best: Element | null = null;
  let bestDepth = -1;
  for (const el of Array.from(body.querySelectorAll("*"))) {
    if (!rendered(el) || !shownText(el).includes(text)) continue;
    const depth = depthOf(el);
    if (depth > bestDepth) {
      best = el;
      bestDepth = depth;
    }
  }
  if (best) return best;
  return shownText(body).includes(text) ? body : null;
}

function describe(el: Element): string {
  const raw = textOf(el);
  const cap = raw.length > LIVE_CAP ? LIVE_CAP : Infinity;
  return `${quote(clean(raw, cap))} [${refFor(el)}]`;
}

export function checkWait(cond: WaitCondition): WaitCheck {
  if (cond.text !== undefined) {
    const live = liveWith(cond.text);
    if (live) {
      return {
        met: true,
        line: `${liveKind(live)} ${describe(live)}`,
        ref: refFor(live),
      };
    }
    const found = elementWith(cond.text);
    const visible = found !== null || bodyText().includes(cond.text);
    if (!visible) return { met: false };
    const base = found ?? smallestWith(cond.text) ?? document.body;
    if (!base) return { met: false };
    let node: Element | null = base;
    while (node && !existingRef(node)) node = node.parentElement;
    const anchor = node ?? base;
    return { met: true, line: describe(anchor), ref: refFor(anchor) };
  }
  if (cond.gone !== undefined) {
    return { met: !bodyText().includes(cond.gone) };
  }
  if (cond.ref_gone !== undefined) {
    const el = lookup(cond.ref_gone);
    return { met: !el || !rendered(el) };
  }
  return { met: false };
}
