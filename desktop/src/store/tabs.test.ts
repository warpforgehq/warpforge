import { beforeEach, describe, expect, it } from "vitest";

import { useTabs } from "./tabs";

const tabs = () => useTabs.getState();

beforeEach(() => {
  useTabs.setState({ open: [], closed: [] });
});

describe("task tabs", () => {
  it("adds a tab once, right of the one it was opened from", () => {
    tabs().ensure("a");
    tabs().ensure("b");
    tabs().ensure("c", "a");
    tabs().ensure("a");
    expect(tabs().open).toEqual(["a", "c", "b"]);
  });

  it("closing hands over to the right neighbour, else the left, else nothing", () => {
    useTabs.setState({ open: ["a", "b", "c"] });
    expect(tabs().close("b")).toBe("c");
    expect(tabs().close("c")).toBe("a");
    expect(tabs().close("a")).toBeNull();
    expect(tabs().close("missing")).toBeNull();
  });

  it("reopens the last closed tab whose task still exists", () => {
    useTabs.setState({ open: ["a", "b", "c"] });
    tabs().close("a");
    tabs().close("b");
    expect(tabs().reopen((id) => id !== "b")).toBe("a");
    expect(tabs().open).toEqual(["c", "a"]);
    expect(tabs().reopen((id) => id !== "b")).toBeNull();
  });

  it("moves a tab and drops tabs whose task is gone", () => {
    useTabs.setState({ open: ["a", "b", "c"], closed: ["d"] });
    tabs().move("c", 0);
    expect(tabs().open).toEqual(["c", "a", "b"]);
    tabs().prune((id) => id !== "a" && id !== "d");
    expect(tabs().open).toEqual(["c", "b"]);
    expect(tabs().closed).toEqual([]);
  });
});
