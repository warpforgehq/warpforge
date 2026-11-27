import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browser = {
  agentCall: vi.fn<(tabId: string, call: unknown, allowed: string[]) => Promise<unknown>>(),
};

vi.mock("./browserClient", () => ({ browser, NO_TAB: "no such browser tab" }));

const { runBrowserAction, SETTLE_MS, SCROLL_SETTLE_MS, WAIT_POLL_MS } =
  await import("./agentActions");

const allowed = ["http://localhost:4400"];
const signal = () => new AbortController().signal;

function action(call: unknown): string {
  return (call as { action?: string }).action ?? "";
}

beforeEach(() => {
  vi.useFakeTimers();
  browser.agentCall.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("settle after click, type and press", () => {
  it("merges changes that arrive during the settle window", async () => {
    browser.agentCall.mockImplementation(async (_tab, call) => {
      if (action(call) === "click") {
        return { url: "http://localhost:4400/", origin: "http://localhost:4400", changes: ["a"] };
      }
      return { url: "http://localhost:4400/", changes: ["a", "b"] };
    });

    const pending = runBrowserAction("t", { action: "click", ref: "e1" }, allowed, signal());
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    const result = await pending;

    expect(result.changes).toEqual(["a", "b"]);
    expect(action(browser.agentCall.mock.calls[1][1])).toBe("changes");
  });

  it("says where the page navigated when it leaves during the settle", async () => {
    browser.agentCall.mockImplementation(async (_tab, call) => {
      if (action(call) === "press") {
        return { url: "http://localhost:4400/", origin: "http://localhost:4400", changes: ["a"] };
      }
      return { url: "http://localhost:4400/next", title: "Next page", changes: ["b"] };
    });

    const pending = runBrowserAction(
      "t",
      { action: "press", key: "Enter", ref: "e1" },
      allowed,
      signal(),
    );
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    const result = await pending;

    expect(result.changes).toEqual(["a", 'navigated → http://localhost:4400/next "Next page"']);
  });

  it("omits the title when the navigated page has none", async () => {
    browser.agentCall.mockImplementation(async (_tab, call) => {
      if (action(call) === "click") {
        return { url: "http://localhost:4400/", origin: "http://localhost:4400", changes: [] };
      }
      return { url: "http://localhost:4400/next", changes: [] };
    });

    const pending = runBrowserAction("t", { action: "click", ref: "e1" }, allowed, signal());
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    const result = await pending;

    expect(result.changes).toEqual(["navigated → http://localhost:4400/next"]);
  });

  it("falls back to the immediate result when the settle call fails", async () => {
    browser.agentCall.mockImplementation(async (_tab, call) => {
      if (action(call) === "click") {
        return { url: "http://localhost:4400/", origin: "http://localhost:4400", changes: ["a"] };
      }
      throw new Error("the page did not run the browser script");
    });

    const pending = runBrowserAction("t", { action: "click", ref: "e1" }, allowed, signal());
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    const result = await pending;

    expect(result.changes).toEqual(["a"]);
  });

  it("does not settle a blocked action", async () => {
    browser.agentCall.mockResolvedValue({ blocked: "https://other.test" });

    const result = await runBrowserAction("t", { action: "click", ref: "e1" }, allowed, signal());
    expect(result.blocked).toBe("https://other.test");
    expect(browser.agentCall).toHaveBeenCalledTimes(1);
  });
});

describe("scroll settle", () => {
  it("waits for scroll events, then reports the position and new elements", async () => {
    browser.agentCall.mockImplementation(async (_tab, call) => {
      switch (action(call)) {
        case "scroll":
          return { url: "http://localhost:4400/", origin: "http://localhost:4400" };
        case "scroll_status":
          return {
            url: "http://localhost:4400/",
            scroll: { y: 900, height: 1000, percent: 100, bottom: true, appeared: 2 },
          };
        default:
          return { url: "http://localhost:4400/", changes: ['status "More loaded" [e4]'] };
      }
    });

    const pending = runBrowserAction("t", { action: "scroll", to: "bottom" }, allowed, signal());
    await vi.advanceTimersByTimeAsync(SCROLL_SETTLE_MS);
    const result = await pending;

    expect(result.scroll).toEqual({
      y: 900,
      height: 1000,
      percent: 100,
      bottom: true,
      appeared: 2,
    });
    expect(result.changes).toEqual(['status "More loaded" [e4]']);
  });
});

describe("wait polling", () => {
  it("polls every 150 ms until the condition is met, then reports elapsed and changes", async () => {
    let checks = 0;
    browser.agentCall.mockImplementation(async (_tab, call) => {
      switch (action(call)) {
        case "mark":
          return { url: "http://localhost:4400/", origin: "http://localhost:4400" };
        case "check_wait":
          checks += 1;
          return checks >= 2
            ? { url: "http://localhost:4400/", met: true, line: 'status "Saved" [e3]' }
            : { url: "http://localhost:4400/", met: false };
        default:
          return { url: "http://localhost:4400/", changes: ['status "Saved" [e3]'] };
      }
    });

    const pending = runBrowserAction("t", { action: "wait", text: "Saved" }, allowed, signal());
    await vi.advanceTimersByTimeAsync(WAIT_POLL_MS);
    const result = await pending;

    expect(result.met).toBe(true);
    expect(result.elapsedMs).toBe(WAIT_POLL_MS);
    expect(result.line).toBe('status "Saved" [e3]');
    expect(result.changes).toEqual(['status "Saved" [e3]']);
  });

  it("stops at the timeout and returns that as a normal result", async () => {
    browser.agentCall.mockImplementation(async (_tab, call) => {
      if (action(call) === "check_wait") return { url: "u", met: false };
      return { url: "u", origin: "http://localhost:4400", changes: [] };
    });

    const pending = runBrowserAction(
      "t",
      { action: "wait", gone: "Loading", timeout_ms: 300 },
      allowed,
      signal(),
    );
    await vi.advanceTimersByTimeAsync(300);
    const result = await pending;

    expect(result.met).toBe(false);
    expect(result.elapsedMs).toBe(300);
  });

  it("keeps polling when a check fails mid-wait and can still meet the condition", async () => {
    let checks = 0;
    browser.agentCall.mockImplementation(async (_tab, call) => {
      switch (action(call)) {
        case "check_wait":
          checks += 1;
          if (checks === 1) throw new Error("did not answer within 10s");
          return { url: "u", met: true, line: 'status "Saved" [e3]' };
        case "changes":
          throw new Error("the page did not run the browser script");
        default:
          return { url: "u", origin: "http://localhost:4400" };
      }
    });

    const pending = runBrowserAction("t", { action: "wait", text: "Saved" }, allowed, signal());
    await vi.advanceTimersByTimeAsync(WAIT_POLL_MS);
    const result = await pending;

    expect(checks).toBe(2);
    expect(result.met).toBe(true);
    expect(result.line).toBe('status "Saved" [e3]');
    expect(result.changes).toBeUndefined();
  });

  it("rejects with the no-tab error instead of polling to the timeout", async () => {
    browser.agentCall.mockImplementation(async (_tab, call) => {
      if (action(call) === "check_wait") throw new Error("no such browser tab");
      return { url: "u", origin: "http://localhost:4400" };
    });

    const pending = runBrowserAction("t", { action: "wait", text: "Saved" }, allowed, signal());
    const settled = pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).rejects.toThrow("no such browser tab");
    await settled;

    const checks = browser.agentCall.mock.calls.filter(([, call]) => action(call) === "check_wait");
    expect(checks).toHaveLength(1);
  });
});
