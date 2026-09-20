import { describe, expect, it } from "vitest";

import { toDisplayUrl, toNavigationUrl } from "./browserUrl";

describe("toNavigationUrl", () => {
  it("keeps a URL that already has a scheme", () => {
    expect(toNavigationUrl("https://github.com/foo")).toBe("https://github.com/foo");
    expect(toNavigationUrl("http://example.com")).toBe("http://example.com");
  });

  it("adds https to a bare host", () => {
    expect(toNavigationUrl("github.com")).toBe("https://github.com");
    expect(toNavigationUrl("example.com/path")).toBe("https://example.com/path");
  });

  it("handles localhost with a port", () => {
    expect(toNavigationUrl("localhost:3000")).toBe("https://localhost:3000");
    expect(toNavigationUrl("127.0.0.1:8080")).toBe("https://127.0.0.1:8080");
  });

  it("searches a phrase with spaces", () => {
    expect(toNavigationUrl("how to center a div")).toBe(
      "https://duckduckgo.com/?q=how%20to%20center%20a%20div",
    );
  });

  it("searches a single bare word with no dot", () => {
    expect(toNavigationUrl("rust")).toBe("https://duckduckgo.com/?q=rust");
  });

  it("is blank for empty input", () => {
    expect(toNavigationUrl("   ")).toBe("about:blank");
  });
});

describe("toDisplayUrl", () => {
  it("shows a real URL unchanged", () => {
    expect(toDisplayUrl("https://github.com")).toBe("https://github.com");
  });

  it("unwraps a search back to the query", () => {
    expect(toDisplayUrl("https://duckduckgo.com/?q=how%20to%20center")).toBe("how to center");
  });

  it("shows nothing for a blank page", () => {
    expect(toDisplayUrl("about:blank")).toBe("");
  });
});
