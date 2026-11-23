import { stringify } from "./builtins";
import { NAME_CAP, TEXT_CAP } from "./constants";
import { refFor } from "./refs";

const TEXT_INPUTS = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
  "date",
  "datetime-local",
  "time",
  "month",
  "week",
  "",
]);
const ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "combobox",
  "textbox",
  "searchbox",
  "slider",
  "treeitem",
]);
const GROUPS: Record<string, string> = {
  FORM: "form",
  NAV: "navigation",
  DIALOG: "dialog",
  MAIN: "main",
};
const LIVE_ROLES = new Set(["status", "alert", "log"]);

/** The word to print for a live region, or null when the element is not one. */
export function liveKind(el: Element): string | null {
  const role = el.getAttribute("role");
  if (role && LIVE_ROLES.has(role)) return role;
  if (el.tagName === "OUTPUT") return "status";
  const aria = el.getAttribute("aria-live");
  return aria && aria !== "off" ? "status" : null;
}

export function clean(text: string | null | undefined, cap: number): string {
  const flat = (text || "").replace(/\s+/g, " ").trim();
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
}

export function quote(text: string): string {
  return stringify(text);
}

export function styleOf(el: Element): CSSStyleDeclaration {
  const view = el.ownerDocument.defaultView || window;
  return view.getComputedStyle(el);
}

export function hidden(el: Element): boolean {
  if ((el as HTMLElement).hidden || el.getAttribute("aria-hidden") === "true") return true;
  const style = styleOf(el);
  return style.display === "none" || style.visibility === "hidden";
}

/** Whether `el` is actually rendered, including hidden ancestors. */
export function rendered(el: Element): boolean {
  const maybe = el as Element & { checkVisibility?: () => boolean };
  if (typeof maybe.checkVisibility === "function") return maybe.checkVisibility();
  if (el.getClientRects().length > 0) return !hidden(el);
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (hidden(node)) return false;
  }
  return true;
}

export function hasBox(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
}

export function labelText(el: Element): string {
  const doc = el.ownerDocument;
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => doc.getElementById(id)?.textContent || "")
      .join(" ");
    if (text.trim()) return text;
  }
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    return Array.from(labels, (l) => l.textContent).join(" ");
  }
  return "";
}

export function nameOf(el: HTMLElement): string {
  const label = labelText(el);
  if (label.trim()) return clean(label, NAME_CAP);
  const tag = el.tagName;
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    if (["submit", "button", "reset"].includes(input.type)) {
      return clean(input.value, NAME_CAP);
    }
    return clean(input.placeholder || input.title || input.name || "", NAME_CAP);
  }
  if (tag === "TEXTAREA") {
    const area = el as HTMLTextAreaElement;
    return clean(area.placeholder || area.title || area.name || "", NAME_CAP);
  }
  if (tag === "SELECT") {
    const select = el as HTMLSelectElement;
    return clean(select.title || select.name || "", NAME_CAP);
  }
  if (tag === "IMG") return clean((el as HTMLImageElement).alt, NAME_CAP);
  const text = el.innerText !== undefined ? el.innerText : el.textContent;
  return clean(text || el.title || "", NAME_CAP);
}

const LEVEL = /^H([1-6])$/;

export function headingLevel(el: Element): number | null {
  const m = LEVEL.exec(el.tagName);
  return m ? Number(m[1]) : null;
}

export function groupOf(el: HTMLElement): string | null {
  const role = el.getAttribute("role");
  if (GROUPS[el.tagName]) return GROUPS[el.tagName];
  if (role === "dialog" || role === "alertdialog") return "dialog";
  return el.getAttribute("aria-modal") === "true" ? "dialog" : null;
}

export function control(el: HTMLElement): string | null {
  const tag = el.tagName;
  const role = el.getAttribute("role");
  if (tag === "A" && el.hasAttribute("href")) {
    return `link ${quote(nameOf(el))} [${refFor(el)}] → ${el.getAttribute("href")}`;
  }
  if (tag === "BUTTON" || (tag === "INPUT" && isButtonInput(el as HTMLInputElement))) {
    return `button ${quote(nameOf(el))} [${refFor(el)}]${(el as HTMLButtonElement).disabled ? " disabled" : ""}`;
  }
  if (tag === "INPUT") {
    const input = el as HTMLInputElement;
    if (input.type === "checkbox" || input.type === "radio") {
      return `${input.type} ${quote(nameOf(el))} [${refFor(el)}] ${input.checked ? "checked" : "unchecked"}`;
    }
    if (TEXT_INPUTS.has(input.type)) {
      const value =
        input.type === "password"
          ? input.value
            ? "(set)"
            : "(empty)"
          : quote(clean(input.value, TEXT_CAP));
      return `textbox ${quote(nameOf(el))} [${refFor(el)}] ${input.type || "text"} value=${value}`;
    }
    if (input.type !== "hidden") {
      return `input ${quote(nameOf(el))} [${refFor(el)}] ${input.type}`;
    }
  }
  if (tag === "TEXTAREA") {
    const area = el as HTMLTextAreaElement;
    return `textbox ${quote(nameOf(el))} [${refFor(el)}] multiline value=${quote(clean(area.value, TEXT_CAP))}`;
  }
  if (tag === "SELECT") {
    const select = el as HTMLSelectElement;
    const options = Array.from(select.options, (o) => clean(o.label || o.text, 40)).slice(0, 12);
    const chosen = select.selectedOptions[0];
    return `select ${quote(nameOf(el))} [${refFor(el)}] value=${quote(chosen ? clean(chosen.label || chosen.text, 40) : "")} options: ${options.join(" | ")}`;
  }
  if (tag === "SUMMARY") return `button ${quote(nameOf(el))} [${refFor(el)}] (disclosure)`;
  if (role && ROLES.has(role)) {
    const state = el.getAttribute("aria-checked") || el.getAttribute("aria-selected");
    return `${role} ${quote(nameOf(el))} [${refFor(el)}]${state ? ` ${role === "tab" || role === "option" ? "selected" : "checked"}=${state}` : ""}`;
  }
  if (el.isContentEditable && !el.parentElement?.isContentEditable) {
    return `textbox ${quote(nameOf(el))} [${refFor(el)}] editable`;
  }
  if (el.hasAttribute("onclick") || (el.tabIndex >= 0 && el.hasAttribute("tabindex"))) {
    return `clickable ${quote(nameOf(el))} [${refFor(el)}]`;
  }
  return null;
}

function isButtonInput(input: HTMLInputElement): boolean {
  return ["submit", "button", "reset"].includes(input.type);
}
