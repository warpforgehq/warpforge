import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { check, prepareUpdateHandoff, resumeAfterFailedUpdate, update } = vi.hoisted(() => ({
  check: vi.fn<() => Promise<unknown>>(),
  prepareUpdateHandoff: vi.fn<() => Promise<never>>(),
  resumeAfterFailedUpdate: vi.fn<() => void>(),
  update: {
    body: "Safer updates",
    download: vi.fn<() => Promise<void>>(async () => {}),
    install: vi.fn<() => Promise<void>>(async () => {}),
    version: "0.2.0",
  },
}));

vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.1.0" }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@/daemon", () => ({
  daemon: {
    prepareUpdateHandoff,
    resumeAfterFailedUpdate,
    waitForDisconnect: vi.fn<() => Promise<void>>(async () => {}),
  },
}));

import { AUTO_CHECK_INTERVAL_MS, DesktopUpdater } from "./updater";

describe("DesktopUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    check.mockResolvedValue(update);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
  });

  it("explains that the update feed is unavailable before the first desktop release", async () => {
    check.mockRejectedValueOnce(new Error("Could not fetch a valid release JSON from the remote"));
    const updater = new DesktopUpdater();

    await updater.check();

    expect(updater.getState()).toMatchObject({
      error:
        "The published update feed is not available yet. This is expected before the first signed desktop release is published; try again later.",
      status: "error",
    });
  });

  it("keeps a downloaded update ready when daemon handoff is refused", async () => {
    prepareUpdateHandoff.mockRejectedValueOnce(new Error("external daemon"));
    const updater = new DesktopUpdater();

    await updater.check();
    await updater.download();
    await updater.installAndRestart();

    expect(updater.getState()).toMatchObject({
      error: "external daemon",
      nextVersion: "0.2.0",
      status: "ready",
    });
    expect(update.install).not.toHaveBeenCalled();
    expect(resumeAfterFailedUpdate).toHaveBeenCalledOnce();
  });

  describe("startAutoCheck", () => {
    /** Lets the updater's own awaits (initialize, the dynamic imports) settle
     *  — fake timers do not advance them on their own. */
    const settle = () => vi.advanceTimersByTimeAsync(0);

    beforeEach(() => {
      vi.useFakeTimers();
      check.mockResolvedValue(null);
      window.localStorage.clear();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("keeps checking on every interval, not just at launch", async () => {
      const updater = new DesktopUpdater();
      updater.startAutoCheck();
      await settle();
      expect(check).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS);
      await settle();
      expect(check).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS);
      await settle();
      expect(check).toHaveBeenCalledTimes(3);
    });

    it("records the last check so a relaunch waits out the remainder", async () => {
      await new DesktopUpdater().check();
      expect(Number(window.localStorage.getItem("warpforge.update.lastCheck"))).toBe(Date.now());

      const relaunched = new DesktopUpdater();
      relaunched.startAutoCheck();
      await settle();
      expect(check).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS);
      await settle();
      expect(check).toHaveBeenCalledTimes(2);
    });

    it("records the last check even when the feed fails", async () => {
      check.mockRejectedValue(new Error("feed unreachable"));
      const updater = new DesktopUpdater();

      await updater.check();

      expect(updater.getState().status).toBe("error");
      expect(Number(window.localStorage.getItem("warpforge.update.lastCheck"))).toBe(Date.now());
    });

    it("never interrupts an update the user is already acting on", async () => {
      check.mockResolvedValue(update);
      const updater = new DesktopUpdater();
      updater.startAutoCheck();
      await settle();
      expect(updater.getState().status).toBe("available");

      await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS * 3);
      await settle();
      expect(check).toHaveBeenCalledTimes(1);
    });

    it("starts one schedule however many callers ask", async () => {
      const updater = new DesktopUpdater();
      updater.startAutoCheck();
      updater.startAutoCheck();
      updater.startAutoCheck();
      await settle();
      expect(check).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS);
      await settle();
      expect(check).toHaveBeenCalledTimes(2);
    });

    it("does nothing outside the desktop shell", async () => {
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
      const updater = new DesktopUpdater();
      await updater.initialize();

      updater.startAutoCheck();
      await vi.advanceTimersByTimeAsync(AUTO_CHECK_INTERVAL_MS * 2);

      expect(check).not.toHaveBeenCalled();
    });
  });
});
