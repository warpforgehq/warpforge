import type { ConsoleMessage } from "./types";

export const stringify = JSON.stringify;
const inputProto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
const textareaProto = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
export const inputValue = inputProto?.set as (this: HTMLInputElement, value: string) => void;
export const textareaValue = textareaProto?.set as (
  this: HTMLTextAreaElement,
  value: string,
) => void;
export const dispatch = EventTarget.prototype.dispatchEvent;
export const Pointer: typeof MouseEvent =
  typeof PointerEvent === "function"
    ? (PointerEvent as unknown as typeof MouseEvent)
    : MouseEvent;
export const loc = window.location;
// `window.__wfConsole` is installed just before this script by `browser_console.js`.
export const consoleMessages: (() => ConsoleMessage[]) | null =
  typeof window.__wfConsole === "function" ? window.__wfConsole : null;
export const mapGet = Map.prototype.get;
export const mapSet = Map.prototype.set;
export const weakGet = WeakMap.prototype.get;
export const weakSet = WeakMap.prototype.set;
export const WeakRefOf = WeakRef;
export const deref = WeakRef.prototype.deref;
const connectedDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, "isConnected");
export const connected = connectedDescriptor?.get as (this: Node) => boolean;
