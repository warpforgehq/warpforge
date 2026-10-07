// ── Daemon → client requests (mirrors crates/warpforge-protocol/src/browser.rs) ──

/** Capability a client registers to receive browser requests. */
export const BROWSER_CAPABILITY = "browser";

/** What an agent asks the project's in-app browser to do. */
export type BrowserAction =
  | { action: "snapshot" }
  | { action: "click"; ref: string }
  | { action: "type"; ref: string; text: string; submit: boolean }
  | { action: "navigate"; url: string }
  | { action: "screenshot" }
  | { action: "console" };

/** The work a `client.request` event asks this client to do. */
export type ClientRequestBody =
  | {
      kind: "browser";
      project: string;
      action: BrowserAction;
      /** The page must be on one of these; otherwise answer `{ blocked: origin }`. */
      allowed_origins: string[];
    }
  | {
      /** Screenshot an agent's HTML page, bootstrap already injected. */
      kind: "html_preview";
      html: string;
      width: number;
      /** The app's current appearance when absent. */
      appearance?: "light" | "dark";
    };
