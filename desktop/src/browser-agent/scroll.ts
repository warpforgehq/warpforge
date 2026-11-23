import { markPage } from "./changes";
import { lookup, missing } from "./refs";
import { STRUCTURE } from "./snapshot";

interface ScrollOptions {
  ref?: string;
  to?: string;
  pages?: number;
}

interface ScrollBase {
  count: number;
  scroller: Element;
}

let base: ScrollBase | null = null;

function styleOverflow(el: Element): string {
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return style?.overflowY ?? "";
}

function scrollable(el: Element): boolean {
  return (
    el.scrollHeight > el.clientHeight &&
    /(auto|scroll|overlay)/.test(styleOverflow(el))
  );
}

function scrollerFor(el: Element | null): Element {
  for (let node = el?.parentElement ?? null; node && node !== document.body; node = node.parentElement) {
    if (scrollable(node)) return node;
  }
  return document.scrollingElement ?? document.documentElement;
}

function countStructure(): number {
  return document.querySelectorAll(STRUCTURE).length;
}

export function scroll(options: ScrollOptions): { error: string } | Record<string, never> {
  let el: Element | null = null;
  if (options.ref) {
    el = lookup(options.ref);
    if (!el) return missing(options.ref);
  }
  const scroller = scrollerFor(el);
  base = { count: countStructure(), scroller };
  markPage();
  if (el) {
    el.scrollIntoView({ block: "center", inline: "center" });
    return {};
  }
  if (options.to === "top") {
    scroller.scrollTop = 0;
  } else if (options.to === "bottom") {
    scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  } else {
    const view = scroller.clientHeight || window.innerHeight || 0;
    scroller.scrollTop += (options.pages ?? 0) * view;
  }
  return {};
}

export interface ScrollReport {
  y: number;
  height: number;
  percent: number;
  bottom: boolean;
  appeared: number;
}

export function scrollStatus(): ScrollReport {
  const scroller = base?.scroller ?? document.scrollingElement ?? document.documentElement;
  const y = Math.round(scroller.scrollTop);
  const height = Math.round(scroller.scrollHeight);
  const view = scroller.clientHeight;
  const max = Math.max(0, height - view);
  return {
    y,
    height,
    percent: max <= 0 ? 100 : Math.min(100, Math.round((y / max) * 100)),
    bottom: y >= max - 1,
    appeared: Math.max(0, countStructure() - (base?.count ?? 0)),
  };
}
