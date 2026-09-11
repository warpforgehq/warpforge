import type { DaemonEndpoint } from "../protocol";
import { DAEMON_PROTOCOL_VERSION } from "./types";

/**
 * Find the daemon endpoint. Inside Tauri, the Rust side reads
 * `~/.warpforge/daemon.json`; in a plain browser (vite dev without Tauri)
 * fall back to the default local port so the UI is still exercisable.
 */
export async function discoverEndpoint(): Promise<DaemonEndpoint> {
  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<DaemonEndpoint>("daemon_endpoint");
  }
  return {
    owner: "external",
    pid: 0,
    protocolVersion: DAEMON_PROTOCOL_VERSION,
    token: "",
    url: "ws://127.0.0.1:61814",
    version: "dev",
  };
}

export async function desktopVersion(): Promise<string> {
  if (!("__TAURI_INTERNALS__" in window)) {
    return "dev";
  }
  const { getVersion } = await import("@tauri-apps/api/app");
  return getVersion();
}

export function connectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("does not match") ||
    (message.includes("daemon protocol") && message.includes("incompatible"))
  ) {
    if (message.toLowerCase().includes("stop the running daemon")) {
      return message;
    }
    return `${message}. Stop the running daemon and relaunch Warpforge.`;
  }
  return message || "Could not connect to the daemon. Warpforge will keep retrying.";
}
