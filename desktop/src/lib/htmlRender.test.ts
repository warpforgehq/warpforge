import { describe, expect, it } from "vitest";

import {
  HTML_RENDER_HOST_CONTEXT_CHANGED,
  HTML_RENDER_OPEN_LINK,
  HTML_RENDER_SIZE_CHANGED,
  HTML_RENDER_THEME_FRAGMENT_KEY,
} from "@/protocol";

import bootstrap from "../../../crates/warpforge-protocol/src/html_render/bootstrap.js?raw";
import toolDefs from "../../../src/mcp/tools/html.rs?raw";
import {
  HTML_RENDER_THEME_VARIABLES,
  htmlRenderFrameHeight,
  htmlRenderResult,
  htmlRenderTheme,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  readContentHeight,
  readLinkRequest,
  themeForAppearance,
} from "./htmlRender";
import { getTheme, THEMES } from "./themes";

describe("htmlRenderTheme", () => {
  it("hands every theme exactly the documented variables", () => {
    for (const theme of THEMES) {
      const { appearance, variables } = htmlRenderTheme(theme);
      expect(appearance).toBe(theme.mode);
      expect(Object.keys(variables).sort()).toEqual([...HTML_RENDER_THEME_VARIABLES].sort());
    }
  });

  it("documents every variable to the agent", () => {
    for (const name of HTML_RENDER_THEME_VARIABLES) {
      if (/^--chart-[2-5]$/.test(name)) continue;
      expect(toolDefs).toContain(name);
    }
  });

  it("wraps theme triplets as colours", () => {
    const { variables } = htmlRenderTheme(getTheme("forge"));
    expect(variables["--background"]).toBe("hsl(120 3% 8%)");
    expect(variables["--chart-1"]).toBe(variables["--primary"]);
  });

  it("previews in the current theme when it matches, else that appearance's default", () => {
    expect(themeForAppearance("paper").id).toBe("paper");
    expect(themeForAppearance("paper", "light").id).toBe("paper");
    expect(themeForAppearance("paper", "dark").mode).toBe("dark");
    expect(themeForAppearance("forge", "light").mode).toBe("light");
  });
});

describe("page messages", () => {
  const size = (height: unknown, extra: Record<string, unknown> = {}) => ({
    jsonrpc: "2.0",
    method: HTML_RENDER_SIZE_CHANGED,
    params: { height },
    ...extra,
  });

  it("reads a content height only from a well-formed size notification", () => {
    expect(readContentHeight(size(321))).toBe(321);
    expect(readContentHeight(size(321, { jsonrpc: "1.0" }))).toBeUndefined();
    expect(readContentHeight(size(321, { method: "other" }))).toBeUndefined();
    expect(readContentHeight(size(Number.POSITIVE_INFINITY))).toBeUndefined();
    expect(readContentHeight(size("321"))).toBeUndefined();
    expect(readContentHeight(size(0))).toBeUndefined();
    expect(readContentHeight(null)).toBeUndefined();
  });

  it("reads only http(s) link requests that carry an id", () => {
    const link = (url: unknown, id: unknown = "wf-link-1") => ({
      jsonrpc: "2.0",
      id,
      method: HTML_RENDER_OPEN_LINK,
      params: { url },
    });
    expect(readLinkRequest(link("https://example.com/a"))).toEqual({
      id: "wf-link-1",
      url: "https://example.com/a",
    });
    expect(readLinkRequest(link("javascript:alert(1)"))).toBeUndefined();
    expect(readLinkRequest(link("file:///etc/passwd"))).toBeUndefined();
    expect(readLinkRequest(link("https://example.com", null))).toBeUndefined();
    expect(htmlRenderResult(7)).toEqual({ jsonrpc: "2.0", id: 7, result: {} });
  });

  it("posts the theme as host context and carries it in the fragment", () => {
    const theme = htmlRenderTheme(getTheme("paper"));
    expect(htmlRenderThemeMessage(theme)).toMatchObject({
      method: HTML_RENDER_HOST_CONTEXT_CHANGED,
      params: { theme: "light", styles: { variables: theme.variables } },
    });
    const fragment = htmlRenderThemeFragment(theme);
    expect(fragment.startsWith(`#${HTML_RENDER_THEME_FRAGMENT_KEY}=`)).toBe(true);
    expect(JSON.parse(decodeURIComponent(fragment.split("=")[1]))).toEqual(theme);
  });

  it("speaks the same names as the page's bootstrap", () => {
    for (const name of [
      HTML_RENDER_HOST_CONTEXT_CHANGED,
      HTML_RENDER_SIZE_CHANGED,
      HTML_RENDER_OPEN_LINK,
      `${HTML_RENDER_THEME_FRAGMENT_KEY}=`,
    ]) {
      expect(bootstrap).toContain(name);
    }
  });
});

describe("htmlRenderFrameHeight", () => {
  it("holds the agent's height until the page reports, then fits it within bounds", () => {
    expect(htmlRenderFrameHeight(400)).toBe(400);
    expect(htmlRenderFrameHeight(400, 612.4)).toBe(612);
    expect(htmlRenderFrameHeight(400, 20)).toBe(80);
    expect(htmlRenderFrameHeight(400, 9000)).toBe(2000);
  });
});
