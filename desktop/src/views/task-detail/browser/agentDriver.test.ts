import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientRequestBody } from "../../../protocol";
import type { BrowserStateEvent, BrowserTitleEvent } from "./browserClient";

const stateHandlers = new Set<(e: BrowserStateEvent) => void>();
const titleHandlers = new Set<(e: BrowserTitleEvent) => void>();
const browser = {
  navigate: vi.fn<(tabId: string, url: string) => Promise<void>>(),
  open: vi.fn<(...args: unknown[]) => Promise<void>>(),
  agentCall: vi.fn<(tabId: string, call: unknown, allowed: string[]) => Promise<unknown>>(),
  agentScreenshot: vi.fn<(tabId: string, allowed: string[]) => Promise<unknown>>(),
  htmlPreview:
    vi.fn<(html: string, width: number, fragment: string) => Promise<Record<string, unknown>>>(),
};

vi.mock("./browserClient", () => ({
  NO_TAB: "no such browser tab",
  browser,
  onBrowserState: (fn: (e: BrowserStateEvent) => void) => {
    stateHandlers.add(fn);
    return Promise.resolve(() => stateHandlers.delete(fn));
  },
  onBrowserTitle: (fn: (e: BrowserTitleEvent) => void) => {
    titleHandlers.add(fn);
    return Promise.resolve(() => titleHandlers.delete(fn));
  },
}));

const { resetAgentTabs, runBrowserRequest } = await import("./agentDriver");
const { clearBrowserSession, loadLiveBrowserSession, onAgentTab, saveLiveBrowserSession } =
  await import("./browserSession");

type BrowserBody = Extract<ClientRequestBody, { kind: "browser" }>;

function request(action: BrowserBody["action"]): ClientRequestBody {
  return { kind: "browser", project: "p", action, allowed_origins: ["http://localhost:4001"] };
}

const signal = () => new AbortController().signal;

/** A page load as the native view reports it. */
function loadPage(tabId: string, url: string) {
  for (const fn of [...stateHandlers]) fn({ tabId, url, loading: true });
  for (const fn of [...stateHandlers]) fn({ tabId, url, loading: false });
}

beforeEach(() => {
  clearBrowserSession("p");
  resetAgentTabs();
  for (const mock of Object.values(browser)) mock.mockReset();
});

describe("runBrowserRequest", () => {
  it("every action after a navigate acts in the agent's tab, not the user's active one", async () => {
    // The user has their own tab open and active, as in the live test.
    saveLiveBrowserSession("p", {
      tabs: [
        {
          id: "p:user",
          url: "https://www.google.com/",
          title: "Google",
          loading: false,
          entries: [],
          pos: 0,
        },
      ],
      activeId: "p:user",
    });
    const shown: string[] = [];
    const off = onAgentTab("p", ({ id }) => shown.push(id));
    browser.navigate.mockRejectedValue("no such browser tab");
    browser.open.mockImplementation(async (...args) => {
      queueMicrotask(() => loadPage(args[0] as string, "http://localhost:4001/"));
    });
    browser.agentCall.mockImplementation(async (tabId) => ({
      tab: tabId,
      url: "http://localhost:4001/",
      title: "Home",
      origin: "http://localhost:4001",
    }));

    const nav = (await runBrowserRequest(
      request({ action: "navigate", url: "http://localhost:4001/" }),
      signal(),
    )) as { tab: string; loading: boolean };
    await runBrowserRequest(request({ action: "snapshot" }), signal());
    await runBrowserRequest(request({ action: "click", ref: "e2" }), signal());
    off();

    expect(nav.tab).not.toBe("p:user");
    expect(nav.loading).toBe(false);
    expect(browser.open).toHaveBeenCalledWith(
      nav.tab,
      "http://localhost:4001/",
      expect.anything(),
      false,
      true,
    );
    const acted = browser.agentCall.mock.calls.map(([tabId]) => tabId);
    expect(new Set(acted)).toEqual(new Set([nav.tab]));
    expect(browser.agentCall).toHaveBeenLastCalledWith(nav.tab, { action: "click", ref: "e2" }, [
      "http://localhost:4001",
    ]);
    expect(shown).toEqual([nav.tab]);
    expect(loadLiveBrowserSession("p")?.activeId).toBe(nav.tab);
    expect(loadLiveBrowserSession("p")?.tabs.map((t) => t.id)).toEqual(["p:user", nav.tab]);
  });

  it("a page that never loads is reported as not loaded, with what the tab still shows", async () => {
    vi.useFakeTimers();
    try {
      browser.navigate.mockRejectedValue("no such browser tab");
      browser.open.mockResolvedValue();
      browser.agentCall.mockResolvedValue({ url: "about:blank", origin: "null" });
      const pending = runBrowserRequest(
        request({ action: "navigate", url: "http://localhost:4400/" }),
        signal(),
      );
      await vi.advanceTimersByTimeAsync(5_000);
      const result = (await pending) as { loading: boolean; url: string; requested: string };
      expect(result.loading).toBe(true);
      expect(result.url).toBe("about:blank");
      expect(result.requested).toBe("http://localhost:4400/");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a page action before any navigate says to navigate first", async () => {
    saveLiveBrowserSession("p", {
      tabs: [
        {
          id: "p:user",
          url: "https://www.google.com/",
          title: "",
          loading: false,
          entries: [],
          pos: 0,
        },
      ],
      activeId: "p:user",
    });
    await expect(runBrowserRequest(request({ action: "snapshot" }), signal())).rejects.toThrow(
      "browser_navigate",
    );
    expect(browser.agentCall).not.toHaveBeenCalled();
  });

  it("a closed agent tab is forgotten and the agent is told to navigate again", async () => {
    browser.navigate.mockResolvedValue();
    browser.agentCall.mockResolvedValueOnce({ url: "http://localhost:4001/" });
    const nav = runBrowserRequest(
      request({ action: "navigate", url: "http://localhost:4001/" }),
      signal(),
    );
    await Promise.resolve();
    await Promise.resolve();
    const tabId = browser.navigate.mock.calls[0]?.[0] ?? "";
    loadPage(tabId, "http://localhost:4001/");
    await nav;

    browser.agentScreenshot.mockRejectedValue("no such browser tab");
    await expect(runBrowserRequest(request({ action: "screenshot" }), signal())).rejects.toThrow(
      "was closed",
    );
    await expect(runBrowserRequest(request({ action: "console" }), signal())).rejects.toThrow(
      "browser_navigate",
    );
  });
});

describe("html previews", () => {
  const preview = (appearance?: "light" | "dark"): ClientRequestBody => ({
    kind: "html_preview",
    html: "<p>x</p>",
    width: 390,
    ...(appearance ? { appearance } : {}),
  });
  const themeIn = (fragment: string) =>
    JSON.parse(decodeURIComponent(fragment.replace("#wf-theme=", ""))) as { appearance: string };

  it("are captured in the asked appearance, or the app's own, without a browser tab", async () => {
    browser.htmlPreview.mockResolvedValue({ data: "iVBO", contentHeight: 300 });

    const light = await runBrowserRequest(preview("light"), signal());
    const [html, width, fragment] = browser.htmlPreview.mock.calls[0];
    expect([html, width]).toEqual(["<p>x</p>", 390]);
    expect(themeIn(fragment).appearance).toBe("light");
    expect(light).toEqual({ data: "iVBO", contentHeight: 300, appearance: "light" });

    const own = await runBrowserRequest(preview(), signal());
    expect(themeIn(browser.htmlPreview.mock.calls[1][2]).appearance).toBe("dark");
    expect(own).toMatchObject({ appearance: "dark" });
    expect(browser.open).not.toHaveBeenCalled();
  });
});
