import { LIVE_CAP, MAX_CHARS, MAX_LINES, NAME_CAP, SCOPED_TEXT_CAP, TEXT_CAP } from "./constants";
import {
  control,
  clean,
  groupOf,
  hasBox,
  headingLevel,
  hidden,
  labelText,
  liveKind,
  nameOf,
  quote,
  rendered,
  styleOf,
  textOf,
} from "./outline";
import { lookup, missing, refFor } from "./refs";

export interface SnapshotOptions {
  interactive?: boolean;
  scope?: string;
  headings?: boolean;
}

export type SnapshotResult = { tree: string; truncated: boolean };

type Push = (depth: number, line: string) => void;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "HEAD"]);

const BLOCK = /^(block|flex|grid|list-item|table|table-row|table-cell|flow-root)$/;
const ROW_GROUP = /^(table-row-group|table-header-group|table-footer-group)$/;
const REF = /^e\d+$/;
// A block with none of these STRUCTURE elements inside is plain text, read as laid out.
export const STRUCTURE =
  "a[href],button,input,select,textarea,summary,[role],[contenteditable],[onclick],[tabindex],h1,h2,h3,h4,h5,h6,img[alt],iframe,form,nav,dialog,main,slot,output,[aria-live]";

function children(node: Node): NodeListOf<ChildNode> | Node[] {
  const shadow = (node as Element).shadowRoot;
  if (shadow) return shadow.childNodes;
  const tag = (node as Element).tagName;
  if (tag === "SLOT") return (node as HTMLSlotElement).assignedNodes({ flatten: true });
  if (tag === "IFRAME") {
    try {
      const body = (node as HTMLIFrameElement).contentDocument?.body;
      return body ? [body] : [];
    } catch {
      return [];
    }
  }
  return node.childNodes;
}

function makeLines(): { push: Push; full: () => boolean; result: () => SnapshotResult } {
  const lines: string[] = [];
  let chars = 0;
  let truncated = false;
  const push: Push = (depth, line) => {
    if (truncated) return;
    const text = "  ".repeat(Math.min(depth, 8)) + line;
    if (lines.length >= MAX_LINES || chars + text.length > MAX_CHARS) {
      truncated = true;
      return;
    }
    lines.push(text);
    chars += text.length + 1;
  };
  return {
    push,
    full: () => truncated,
    result: () => ({ tree: lines.join("\n"), truncated }),
  };
}

function pushGroup(push: Push, el: HTMLElement, group: string, depth: number): void {
  const name = labelText(el).trim();
  push(depth, `${group}${name ? ` ${quote(clean(name, NAME_CAP))}` : ""} [${refFor(el)}]:`);
}

function hasOtherHeading(parent: Element, anchor: Element): boolean {
  return Array.from(parent.querySelectorAll("h1,h2,h3,h4,h5,h6")).some((h) => !anchor.contains(h));
}

function reachesLevel(el: Element, level: number): boolean {
  const own = headingLevel(el);
  if (own !== null) return own <= level;
  const heads = el.querySelectorAll("h1,h2,h3,h4,h5,h6");
  return Array.from(heads, (h) => headingLevel(h) ?? 9).some((l) => l <= level);
}

/**
 * A page may wrap a heading with its edit controls, so climb to the largest
 * wrapper that still holds only this heading; the section then runs to the next
 * heading of the same or a higher level, inside the same parent.
 * @param heading - The heading element the section starts at.
 * @returns The nodes that make up the section, the heading's wrapper first.
 */
export function sectionOf(heading: Element): Node[] {
  const level = headingLevel(heading) ?? 6;
  let anchor = heading;
  while (
    anchor.parentElement &&
    anchor.parentElement !== document.body &&
    !hasOtherHeading(anchor.parentElement, anchor)
  ) {
    anchor = anchor.parentElement;
  }
  const nodes: Node[] = [anchor];
  let sib = anchor.nextElementSibling;
  while (sib && !reachesLevel(sib, level)) {
    nodes.push(sib);
    sib = sib.nextElementSibling;
  }
  return nodes;
}

function isBlockish(el: Element): boolean {
  const display = styleOf(el).display;
  return BLOCK.test(display) || ROW_GROUP.test(display);
}

// A block is a leaf only when its children are inline content; a list, a table
// or a wrapper holding paragraphs keeps its children as separate lines.
function hasBlockChild(el: Element): boolean {
  return Array.from(el.children).some(isBlockish);
}

function rowText(row: Element): string {
  return Array.from(row.children)
    .filter((cell) => /^T[DH]$/.test(cell.tagName))
    .map(textOf)
    .join(" | ");
}

// Scope is a ref (e12), else a CSS selector, else a heading's text. The ref form
// is unambiguous, so a stale ref is an error rather than a selector to try.
function resolveScope(scope: string): Element | { error: string } {
  if (REF.test(scope)) return lookup(scope) ?? missing(scope);
  let match: Element | null = null;
  try {
    match = Array.from(document.querySelectorAll(scope)).find(rendered) ?? null;
  } catch {
    match = null;
  }
  if (match) return match;
  const wanted = scope.trim().toLowerCase();
  const heads = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
    .filter(rendered)
    .map((h) => ({ h, name: nameOf(h as HTMLElement).trim().toLowerCase() }));
  const exact = heads.find((head) => head.name === wanted);
  if (exact) return exact.h;
  const prefix = heads.find((head) => wanted && head.name.startsWith(wanted));
  if (prefix) return prefix.h;
  return {
    error: `No element, CSS selector or heading matches "${scope}"; give a ref like e12, a CSS selector, or a heading's text.`,
  };
}

/**
 * Outline the page, or the scoped part of it, as indented lines for the agent.
 * @param options - Interactive-only, headings-only and scope (ref, selector or heading text).
 * @returns The outline and whether it was cut short, or an error for a scope that matches nothing.
 */
export function snapshot(options: SnapshotOptions = {}): SnapshotResult | { error: string } {
  const interactive = Boolean(options.interactive);
  const textCap = options.scope !== undefined ? SCOPED_TEXT_CAP : TEXT_CAP;
  let roots: Node[] = [];
  if (options.scope !== undefined) {
    const scoped = resolveScope(options.scope);
    if ("error" in scoped) return scoped;
    roots = headingLevel(scoped) !== null ? sectionOf(scoped) : [scoped];
  }
  const page = document.body || document.documentElement;
  if (roots.length === 0 && page) roots = [page];
  if (options.headings) return outlineHeadings(roots);

  const { push, full, result } = makeLines();
  let pending = "";
  let textless = false;
  const flush = (depth: number) => {
    if (interactive || textless) return;
    const text = clean(pending, textCap);
    pending = "";
    if (text) push(depth, `text ${quote(text)}`);
  };

  function walk(node: Node, depth: number): void {
    if (full()) return;
    if (node.nodeType === Node.TEXT_NODE) {
      // Text nodes join as written: a space the page did not put between two
      // inline pieces is not added here.
      if (!interactive && !textless) pending += (node as Text).data;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      for (const child of Array.from(children(node))) walk(child, depth);
      return;
    }
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (SKIP_TAGS.has(tag.toUpperCase())) return;
    if (hidden(el)) return;
    const live = textless ? null : liveKind(el);
    if (live) {
      flush(depth);
      const message = clean(textOf(el), Infinity);
      // Some pages mark a whole content area live; outline it rather than flatten it.
      if (message.length > LIVE_CAP) {
        push(depth, `${live} [${refFor(el)}]:`);
        for (const child of Array.from(children(el))) walk(child, depth + 1);
        flush(depth + 1);
        return;
      }
      if (message) push(depth, `${live} ${quote(message)} [${refFor(el)}]`);
      // A live region's text is the message above; only its controls are listed.
      const before = pending;
      pending = "";
      textless = true;
      for (const child of Array.from(children(el))) walk(child, depth + 1);
      textless = false;
      pending = before;
      return;
    }
    const line = control(el);
    if (line) {
      flush(depth);
      if (hasBox(el)) push(depth, line);
      if (tag !== "SELECT" && tag !== "TEXTAREA" && tag !== "INPUT" && !el.isContentEditable) {
        // A control's own text is its name; only nested controls are listed.
        const before = pending;
        for (const child of Array.from(children(el))) walk(child, depth + 1);
        pending = before;
      }
      return;
    }
    if (/^H[1-6]$/.test(tag)) {
      flush(depth);
      push(depth, `heading ${quote(nameOf(el))} (${tag.toLowerCase()}) [${refFor(el)}]`);
      return;
    }
    if (tag === "IMG") {
      if (interactive || textless) return;
      const alt = clean((el as HTMLImageElement).alt, NAME_CAP);
      if (alt) {
        flush(depth);
        push(depth, `img ${quote(alt)}`);
      }
      return;
    }
    if (tag === "IFRAME" && !(el as HTMLIFrameElement).contentDocument) {
      flush(depth);
      push(depth, `iframe (another site, not readable) ${(el as HTMLIFrameElement).src || ""}`);
      return;
    }
    const group = groupOf(el);
    let inner = depth;
    if (group) {
      flush(depth);
      pushGroup(push, el, group, depth);
      inner = depth + 1;
    }
    const block = group || BLOCK.test(styleOf(el).display);
    if (!interactive && !textless && block && !group && !el.shadowRoot && !el.querySelector(STRUCTURE)) {
      if (tag === "TR") {
        flush(depth);
        pending = rowText(el);
        flush(depth);
        return;
      }
      if (typeof el.innerText === "string" && !hasBlockChild(el)) {
        flush(depth);
        pending = el.innerText;
        flush(depth);
        return;
      }
    }
    if (block) flush(depth);
    if (!interactive && !textless && tag === "BR") pending += " ";
    for (const child of Array.from(children(el))) walk(child, inner);
    if (block) flush(inner);
  }

  for (const root of roots) walk(root, 0);
  flush(0);
  return result();
}

/** Only headings and group lines, indented by heading level, to map a long page. */
function outlineHeadings(roots: Node[]): SnapshotResult {
  const { push, full, result } = makeLines();
  function walk(node: Node, depth: number): void {
    if (full()) return;
    if (node.nodeType !== Node.ELEMENT_NODE) {
      if (node.nodeType !== Node.TEXT_NODE) {
        for (const child of Array.from(children(node))) walk(child, depth);
      }
      return;
    }
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (SKIP_TAGS.has(tag.toUpperCase())) return;
    if (hidden(el)) return;
    const group = groupOf(el);
    let inner = depth;
    if (group) {
      pushGroup(push, el, group, depth);
      inner = depth + 1;
    }
    const level = headingLevel(el);
    if (level !== null) {
      push(level - 1, `heading ${quote(nameOf(el))} (h${level}) [${refFor(el)}]`);
    }
    for (const child of Array.from(children(el))) walk(child, inner);
  }
  for (const root of roots) walk(root, 0);
  return result();
}
