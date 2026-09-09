import { describe, expect, it } from "vitest";

import confRaw from "../src-tauri/tauri.conf.json?raw";

/**
 * The packaged app's CSP, which the dev server never sees: with `devUrl` the
 * frontend is served by Vite and Tauri applies this policy only to its own
 * asset protocol. Every rule below cost a debugging session in a release
 * build, so they are asserted here rather than rediscovered there.
 */
const conf = JSON.parse(confRaw) as {
  app: {
    security: { csp: string; dangerousDisableAssetCspModification?: string[] | boolean };
  };
};

const security = conf.app.security;

function directive(name: string): string[] {
  const found = security.csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found ? found.split(/\s+/).slice(1) : [];
}

const disabled = security.dangerousDisableAssetCspModification;
const modificationDisabledFor = (name: string) =>
  disabled === true || (Array.isArray(disabled) && disabled.includes(name));

describe("packaged app CSP", () => {
  it("keeps 'unsafe-inline' effective for styles", () => {
    // CodeMirror, xterm and every other library that injects a stylesheet or
    // an inline style attribute at runtime depends on this. Tauri injects a
    // nonce into `style-src` unless asset CSP modification is disabled for it,
    // and per CSP a nonce makes the browser *ignore* 'unsafe-inline' — which
    // silently strips the editor and the terminal of all their styling.
    expect(directive("style-src")).toContain("'unsafe-inline'");
    expect(modificationDisabledFor("style-src")).toBe(true);
  });

  it("still lets Tauri nonce scripts", () => {
    // The inline boot script in index.html is allowed by that nonce, not by
    // 'unsafe-inline' — disabling this modification would break appearance
    // before first paint and give up the XSS protection with it.
    expect(modificationDisabledFor("script-src")).toBe(false);
  });

  it("allows the IPC custom protocol", () => {
    // Without these, `ipc://localhost` is refused and Tauri falls back to the
    // slower postMessage interface.
    const connect = directive("connect-src");
    expect(connect).toContain("ipc:");
    expect(connect).toContain("http://ipc.localhost");
  });

  it("still reaches the daemon over a local websocket", () => {
    expect(directive("connect-src")).toContain("ws://127.0.0.1:*");
  });
});
