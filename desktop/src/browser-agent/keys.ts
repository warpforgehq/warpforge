import { dispatch } from "./builtins";
import { capturePage, markPage, pageChanges } from "./changes";
import { lookup, missing, refFor } from "./refs";

interface KeyDef {
  key: string;
  code: string;
  keyCode: number;
  shift?: boolean;
}

const KEYS: Record<string, KeyDef> = {
  Enter: { key: "Enter", code: "Enter", keyCode: 13 },
  Escape: { key: "Escape", code: "Escape", keyCode: 27 },
  Tab: { key: "Tab", code: "Tab", keyCode: 9 },
  "Shift+Tab": { key: "Tab", code: "Tab", keyCode: 9, shift: true },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  Space: { key: " ", code: "Space", keyCode: 32 },
  PageUp: { key: "PageUp", code: "PageUp", keyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", keyCode: 34 },
  Home: { key: "Home", code: "Home", keyCode: 36 },
  End: { key: "End", code: "End", keyCode: 35 },
  Backspace: { key: "Backspace", code: "Backspace", keyCode: 8 },
  Delete: { key: "Delete", code: "Delete", keyCode: 46 },
};

const TABBABLE =
  'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable="true"],[role="button"],[role="tab"],[role="menuitem"]';

function keyEvent(target: EventTarget, eventName: string, def: KeyDef): boolean {
  const event = new KeyboardEvent(eventName, {
    key: def.key,
    code: def.code,
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey: Boolean(def.shift),
  });
  Object.defineProperty(event, "keyCode", { get: () => def.keyCode });
  Object.defineProperty(event, "which", { get: () => def.keyCode });
  return dispatch.call(target, event);
}

function visible(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute("aria-hidden") === "true") return false;
  if ((el as HTMLInputElement).disabled) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  return !style || (style.display !== "none" && style.visibility !== "hidden");
}

function tabbables(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (el) => visible(el) && el.tabIndex >= 0,
  );
}

function moveFocus(back: boolean): HTMLElement | null {
  const list = tabbables();
  if (list.length === 0) return null;
  const index = list.indexOf(document.activeElement as HTMLElement);
  const step = back ? -1 : 1;
  const next =
    index < 0 ? (back ? list.length - 1 : 0) : (index + step + list.length) % list.length;
  list[next].focus();
  return list[next];
}

function isCheckable(el: HTMLElement): boolean {
  return (
    el.tagName === "INPUT" &&
    ((el as HTMLInputElement).type === "checkbox" || (el as HTMLInputElement).type === "radio")
  );
}

function submit(el: HTMLElement): void {
  const input = el as HTMLInputElement;
  if (el.tagName !== "INPUT" || !input.form) return;
  if (["checkbox", "radio", "submit", "button", "reset"].includes(input.type)) return;
  const form = input.form;
  if (typeof form.requestSubmit === "function") form.requestSubmit();
  else form.submit();
}

export function press(
  ref: string | undefined,
  name: string,
): { note: string; changes: string[] } | { error: string } {
  const def = KEYS[name];
  if (!def) return { error: `unknown key ${name}` };
  let el: HTMLElement | null = null;
  if (ref) {
    el = (lookup(ref) as HTMLElement | null) ?? null;
    if (!el) return missing(ref);
  } else {
    el = (document.activeElement as HTMLElement | null) ?? document.body;
  }
  const target = el as HTMLElement;
  const before = capturePage();
  markPage(before);
  if (ref) target.focus({ preventScroll: true });
  const proceed = keyEvent(target, "keydown", def);
  if (def.key === "Enter" || def.key === " ") keyEvent(target, "keypress", def);
  keyEvent(target, "keyup", def);
  let note = "";
  if (proceed && name === "Tab") {
    const focused = moveFocus(false);
    if (focused) note = `focus moved to [${refFor(focused)}]`;
  } else if (proceed && name === "Shift+Tab") {
    const focused = moveFocus(true);
    if (focused) note = `focus moved to [${refFor(focused)}]`;
  } else if (proceed && name === "Enter") {
    submit(target);
  } else if (
    proceed &&
    name === "Space" &&
    (target.tagName === "BUTTON" || isCheckable(target))
  ) {
    target.click();
  }
  return { note, changes: pageChanges(before) };
}
