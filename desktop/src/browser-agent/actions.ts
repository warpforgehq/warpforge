import { dispatch, inputValue, Pointer, textareaValue } from "./builtins";
import { capturePage, markPage, pageChanges } from "./changes";
import { keyEvent, KEYS } from "./keys";
import { isCheckable, quote } from "./outline";
import { lookup, missing } from "./refs";

type EventCtor = new (type: string, init?: EventInit) => Event;
type EventInitBag = EventInit & Record<string, unknown>;

function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const className = (el as HTMLElement).className;
  const cls =
    typeof className === "string" && className ? `.${className.trim().split(/\s+/)[0]}` : "";
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

function fire(el: EventTarget, Kind: EventCtor, eventName: string, init?: EventInitBag): boolean {
  return dispatch.call(el, new Kind(eventName, init));
}

export function click(ref: string): { note: string; changes: string[] } | { error: string } {
  const el = lookup(ref);
  if (!el) return missing(ref);
  const before = capturePage();
  markPage(before);
  el.scrollIntoView({ block: "center", inline: "center" });
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const doc = el.ownerDocument;
  let note = "";
  const hit = typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(x, y) : null;
  if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
    note = `${ref} is covered by ${describe(hit)} at its centre; the events went to ${ref} itself.`;
  }
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
    button: 0,
  };
  const pointer = { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true };
  fire(el, Pointer, "pointerover", pointer);
  fire(el, MouseEvent, "mouseover", base);
  fire(el, Pointer, "pointermove", pointer);
  fire(el, MouseEvent, "mousemove", base);
  fire(el, Pointer, "pointerdown", { ...pointer, buttons: 1 });
  // A prevented mousedown keeps focus where it was, as in a real click.
  const focus = fire(el, MouseEvent, "mousedown", { ...base, buttons: 1, detail: 1 });
  if (focus && typeof (el as HTMLElement).focus === "function") {
    (el as HTMLElement).focus({ preventScroll: true });
  }
  fire(el, Pointer, "pointerup", pointer);
  fire(el, MouseEvent, "mouseup", { ...base, detail: 1 });
  // A synthetic click still runs activation: links follow, boxes toggle, submit buttons submit.
  fire(el, MouseEvent, "click", { ...base, detail: 1 });
  const anchor = el.closest && el.closest("a[target=_blank]");
  if (anchor) {
    note += `${note ? " " : ""}The link opens a new window, which the in-app browser does not do; open ${(anchor as HTMLAnchorElement).href} with browser_navigate instead.`;
  }
  return { note, changes: pageChanges(before) };
}

function pressEnter(el: HTMLElement): void {
  const proceed = keyEvent(el, "keydown", KEYS.Enter);
  keyEvent(el, "keypress", KEYS.Enter);
  keyEvent(el, "keyup", KEYS.Enter);
  if (proceed && el.tagName === "INPUT" && (el as HTMLInputElement).form) {
    // Enter in a single-line field submits its form; a synthetic key does not.
    const form = (el as HTMLInputElement).form!;
    if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
  }
}

export function type(
  ref: string,
  text: string,
  submit: boolean,
): { note: string; changes: string[] } | { error: string } {
  const el = lookup(ref);
  if (!el) return missing(ref);
  el.scrollIntoView({ block: "center", inline: "center" });
  const before = capturePage();
  markPage(before);
  const field = el as HTMLElement;
  if (typeof field.focus === "function") field.focus({ preventScroll: true });
  const tag = el.tagName;
  if (tag === "SELECT") {
    const select = el as HTMLSelectElement;
    const wanted = text.trim().toLowerCase();
    const option = Array.from(select.options).find(
      (o) =>
        o.value.toLowerCase() === wanted ||
        (o.label || o.text).trim().toLowerCase() === wanted,
    );
    if (!option) {
      return {
        error: `${ref} has no option ${quote(text)}; its options are listed in browser_snapshot.`,
      };
    }
    option.selected = true;
  } else if (tag === "INPUT" && isCheckable(field)) {
    return {
      error: `${ref} is a ${(el as HTMLInputElement).type}; use browser_click to toggle it.`,
    };
  } else if (tag === "INPUT" || tag === "TEXTAREA") {
    // Frameworks track the value through the prototype setter; assigning `el.value`
    // directly would be invisible to a React onChange.
    if (tag === "INPUT") inputValue.call(field as HTMLInputElement, text);
    else textareaValue.call(field as HTMLTextAreaElement, text);
  } else if (field.isContentEditable) {
    const selection = field.ownerDocument.getSelection();
    const range = field.ownerDocument.createRange();
    range.selectNodeContents(field);
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (!field.ownerDocument.execCommand("insertText", false, text)) field.textContent = text;
  } else {
    return { error: `${ref} is not a text field; use browser_click on it instead.` };
  }
  if (!field.isContentEditable) {
    fire(field, InputEvent, "input", {
      bubbles: true,
      composed: true,
      inputType: "insertText",
      data: text,
    });
    fire(field, Event, "change", { bubbles: true });
  }
  if (submit) pressEnter(field);
  return { note: "", changes: pageChanges(before) };
}
