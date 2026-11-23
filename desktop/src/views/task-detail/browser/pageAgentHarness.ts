import { act } from "@testing-library/react";

import script from "../../../../src-tauri/src/browser_agent.js?raw";
import consoleScript from "../../../../src-tauri/src/browser_console.js?raw";

export interface Result {
  blocked?: string;
  origin?: string;
  url: string;
  title: string;
  tree?: string;
  truncated?: boolean;
  note?: string;
  changes?: string[];
  error?: string;
  messages?: { level: string; text: string }[];
  met?: boolean;
  elapsedMs?: number;
  line?: string;
  ref?: string;
  scroll?: { y: number; height: number; percent: number; bottom: boolean; appeared: number };
}

type Agent = (call: Record<string, unknown>) => string;

/** The entry point the script installs on the page's window. */
export const ENTRY = "__wfAgent";
export const page = window as unknown as Record<string, unknown>;

/** Install both page scripts and the layout stubs jsdom lacks. */
export function installPageAgent(): void {
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 20, bottom: 20, width: 20, height: 20 }) as DOMRect;
  Element.prototype.scrollIntoView = () => {};
  new Function(consoleScript)();
  new Function(script)();
}

/** Run a call as the host does; the page's own origin is allowed unless the
 *  call says otherwise. */
export function agent(call: Record<string, unknown>): Result {
  const run = page[ENTRY] as Agent;
  let out = "";
  act(() => {
    out = run({ allowed: [window.location.origin], ...call });
  });
  return JSON.parse(out) as Result;
}

/** The ref the outline gave the first line containing `label`. */
export function refOf(tree: string, label: string): string {
  const line = tree.split("\n").find((l) => l.includes(label));
  const ref = line?.match(/\[(e\d+)\]/)?.[1];
  if (!ref) throw new Error(`no ref for ${label} in:\n${tree}`);
  return ref;
}
