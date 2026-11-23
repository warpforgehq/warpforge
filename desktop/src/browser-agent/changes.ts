import { loc } from "./builtins";
import { INLINE_CAP, LIVE_CAP, LIVE_SELECTOR, MAX_CHANGES, NAME_CAP } from "./constants";
import { clean, groupOf, labelText, liveKind, quote, rendered, textOf } from "./outline";
import { refFor } from "./refs";
import { snapshot } from "./snapshot";

const DIALOG_SELECTOR = "dialog,[role=dialog],[role=alertdialog],[aria-modal=true]";
const POPUP_SELECTOR = "[role=menu],[role=listbox]";

interface LiveText {
  el: Element;
  kind: string;
  text: string;
}

interface Popup {
  el: Element;
  kind: string;
}

export interface PageState {
  url: string;
  live: LiveText[];
  dialogs: Element[];
  popups: Popup[];
}

// The state the last action (or an explicit mark) captured, so a later
// `changes` call can report what arrived after it, e.g. a slow toast.
let pending: PageState | null = null;

export function markPage(state?: PageState): void {
  pending = state ?? capturePage();
}

export function takeChanges(): string[] {
  const before = pending;
  pending = null;
  return before ? pageChanges(before) : [];
}

function liveText(el: Element): string {
  return clean(textOf(el), Infinity);
}

function dialogOpen(el: Element): boolean {
  if (el.tagName === "DIALOG" && !(el as HTMLDialogElement).open) return false;
  return rendered(el);
}

function popupOf(el: Element): Popup | null {
  const kind = el.getAttribute("role");
  if ((kind === "menu" || kind === "listbox") && groupOf(el as HTMLElement) !== "dialog") {
    return { el, kind };
  }
  return null;
}

/**
 * Record the visible live regions, dialogs and popups, and the URL, before an action.
 * @returns The page state `pageChanges` compares against.
 */
export function capturePage(): PageState {
  const live: LiveText[] = [];
  for (const el of Array.from(document.querySelectorAll(LIVE_SELECTOR))) {
    const kind = liveKind(el);
    if (kind && rendered(el)) live.push({ el, kind, text: liveText(el) });
  }
  const dialogs = Array.from(document.querySelectorAll(DIALOG_SELECTOR)).filter(dialogOpen);
  const popups = Array.from(document.querySelectorAll(POPUP_SELECTOR))
    .map(popupOf)
    .filter((p): p is Popup => p !== null && rendered(p.el));
  return { url: loc.href, live, dialogs, popups };
}

function liveLine(kind: string, text: string, el: Element): string {
  const ref = refFor(el);
  return text.length > LIVE_CAP ? `${kind} [${ref}] changed` : `${kind} ${quote(text)} [${ref}]`;
}

function named(word: string, el: Element): string {
  const name = clean(labelText(el), NAME_CAP);
  return name ? `${word} ${quote(name)}` : word;
}

/** The outline snapshot(scope) would print, cut to INLINE_CAP characters. */
function inline(ref: string): string {
  const out = snapshot({ interactive: true, scope: ref });
  if ("error" in out) return "";
  if (!out.truncated && out.tree.length <= INLINE_CAP) return out.tree;
  const tree = out.tree.slice(0, INLINE_CAP);
  return `${tree}\n… (take browser_snapshot with scope ${ref} for the rest)`;
}

/**
 * What changed since `before`, as lines for the agent; capped at MAX_CHANGES.
 * @param before - The state `capturePage` recorded before the action.
 * @returns The change lines, empty when nothing changed.
 */
export function pageChanges(before: PageState): string[] {
  const after = capturePage();
  const out: string[] = [];

  for (const now of after.live) {
    const was = before.live.find((s) => s.el === now.el);
    if (was && was.text === now.text) continue;
    if (!now.text) continue;
    out.push(liveLine(now.kind, now.text, now.el));
  }
  for (const el of after.dialogs) {
    if (before.dialogs.includes(el)) continue;
    const ref = refFor(el);
    out.push([`${named("dialog", el)} [${ref}] opened`, inline(ref)].filter(Boolean).join("\n"));
  }
  for (const el of before.dialogs) {
    if (!after.dialogs.includes(el)) out.push(`${named("dialog", el)} [${refFor(el)}] closed`);
  }
  for (const popup of after.popups) {
    if (before.popups.some((p) => p.el === popup.el)) continue;
    const ref = refFor(popup.el);
    const head =
      popup.kind === "menu"
        ? `${named("menu", popup.el)} [${ref}] opened`
        : `${popup.kind} [${ref}] opened`;
    out.push([head, inline(ref)].filter(Boolean).join("\n"));
  }
  for (const popup of before.popups) {
    if (after.popups.some((p) => p.el === popup.el)) continue;
    const word = popup.kind === "menu" ? named("menu", popup.el) : popup.kind;
    out.push(`${word} [${refFor(popup.el)}] closed`);
  }
  if (after.url !== before.url) out.push(`url → ${after.url}`);

  if (out.length <= MAX_CHANGES) return out;
  const extra = out.length - MAX_CHANGES;
  return [...out.slice(0, MAX_CHANGES), `… ${extra} more changes`];
}
