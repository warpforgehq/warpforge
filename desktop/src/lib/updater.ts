import type { Update } from "@tauri-apps/plugin-updater";

import { daemon } from "@/daemon";

export type UpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export interface UpdaterState {
  status: UpdateStatus;
  currentVersion: string;
  nextVersion?: string;
  notes?: string;
  progress?: number;
  error?: string;
}

type Listener = () => void;

/** Four checks a day while the app stays open, so a release is never more than
 *  a few hours away from being offered. */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const LAST_CHECK_KEY = "warpforge.update.lastCheck";

/** Statuses an automatic check may interrupt. Anything else means a check,
 *  download or install is already in flight and the user is watching it. */
const AUTO_CHECKABLE: UpdateStatus[] = ["idle", "upToDate", "error"];

function readLastCheck(): number {
  try {
    const raw = Number(window.localStorage.getItem(LAST_CHECK_KEY));
    return Number.isFinite(raw) ? raw : 0;
  } catch {
    return 0;
  }
}

function writeLastCheck(at: number) {
  try {
    window.localStorage.setItem(LAST_CHECK_KEY, String(at));
  } catch {
    // A webview with storage disabled just re-checks a launch earlier.
  }
}

export class DesktopUpdater {
  private listeners = new Set<Listener>();
  private update: Update | null = null;
  private initialized = false;
  private autoCheckStarted = false;
  private state: UpdaterState = {
    currentVersion: "dev",
    status: "idle",
  };

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private setState(patch: Partial<UpdaterState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    if (!("__TAURI_INTERNALS__" in window)) {
      this.setState({ status: "unsupported" });
      return;
    }
    const { getVersion } = await import("@tauri-apps/api/app");
    this.setState({ currentVersion: await getVersion() });
  }

  async check() {
    await this.initialize();
    if (this.state.status === "unsupported") return this.state;
    this.setState({ error: undefined, progress: undefined, status: "checking" });
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      this.update = await check();
      if (!this.update) {
        this.setState({ nextVersion: undefined, notes: undefined, status: "upToDate" });
      } else {
        this.setState({
          nextVersion: this.update.version,
          notes: this.update.body ?? undefined,
          status: "available",
        });
      }
    } catch (error) {
      this.setState({ error: checkErrorMessage(error), status: "error" });
    }
    // A failed check still counts: retrying a dead feed every mount is noise.
    writeLastCheck(Date.now());
    return this.state;
  }

  /**
   * Keeps checking for the lifetime of the window, picking up where the last
   * run left off so a long-lived session and a relaunch cost the same number
   * of checks. Idempotent — both sidebar mounts call it.
   */
  startAutoCheck() {
    if (this.autoCheckStarted || this.state.status === "unsupported") return;
    this.autoCheckStarted = true;
    const start = () => {
      void this.autoCheck();
      window.setInterval(() => void this.autoCheck(), AUTO_CHECK_INTERVAL_MS);
    };
    const due = readLastCheck() + AUTO_CHECK_INTERVAL_MS - Date.now();
    if (due <= 0) start();
    else window.setTimeout(start, due);
  }

  private async autoCheck() {
    if (!AUTO_CHECKABLE.includes(this.state.status)) return;
    await this.check();
  }

  async download() {
    if (!this.update) return;
    let downloaded = 0;
    let total: number | undefined;
    this.setState({ error: undefined, progress: 0, status: "downloading" });
    try {
      await this.update.download((event) => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        this.setState({ progress: total ? Math.min(100, (downloaded / total) * 100) : undefined });
      });
      this.setState({ progress: 100, status: "ready" });
    } catch (error) {
      this.setState({ error: messageOf(error), status: "error" });
    }
  }

  async installAndRestart() {
    if (!this.update || this.state.status !== "ready") return;
    this.setState({ error: undefined, status: "installing" });
    let handoffAccepted = false;
    try {
      const handoff = await daemon.prepareUpdateHandoff();
      if (!handoff.ready) {
        this.setState({
          error: `Finish active work before updating: ${handoff.blockers.join(", ")}`,
          status: "ready",
        });
        return;
      }
      handoffAccepted = true;
      await daemon.waitForDisconnect();
      await this.update.install();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      if (handoffAccepted) {
        // The owned daemon is already gone. Relaunch even when installation
        // fails so setup can restore the current bundled daemon and the app
        // never remains connected to a dead runtime.
        try {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
          return;
        } catch (relaunchError) {
          this.setState({
            error: `${messageOf(error)}; Warpforge could not relaunch: ${messageOf(relaunchError)}`,
            status: "error",
          });
          return;
        }
      }
      daemon.resumeAfterFailedUpdate();
      // The downloaded and verified update is still reusable when handoff was
      // refused (for example because an external daemon is running).
      this.setState({ error: messageOf(error), status: "ready" });
    }
  }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const checkErrorMessage = (error: unknown) => {
  const message = messageOf(error);
  if (message.includes("Could not fetch a valid release JSON from the remote")) {
    return "The published update feed is not available yet. This is expected before the first signed desktop release is published; try again later.";
  }
  return message;
};

export const updater = new DesktopUpdater();
