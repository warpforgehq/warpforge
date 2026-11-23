import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { agent, installPageAgent, refOf } from "./pageAgentHarness";

beforeAll(() => {
  installPageAgent();
});

afterEach(cleanup);

function portal(html: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  document.body.appendChild(holder);
  return holder;
}

describe("browser_scroll", () => {
  it("scrolls to the bottom, sees items a scroll listener appended, and reports the new count", () => {
    // jsdom has no layout and does not fire scroll on its own, so this test
    // gives the scrolling element a size and dispatches the scroll event the
    // browser would fire on the next frame.
    const root = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    const height = Object.getOwnPropertyDescriptor(root, "scrollHeight");
    const client = Object.getOwnPropertyDescriptor(root, "clientHeight");
    Object.defineProperty(root, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 400, configurable: true });
    root.scrollTop = 0;
    const holder = portal('<div role="list"><span>Item 1</span></div>');
    const onScroll = () => {
      holder.innerHTML = '<div role="list"><span>Item 1</span><span>Item 2</span></div>' +
        '<button type="button">Load more</button>';
    };
    root.addEventListener("scroll", onScroll);
    try {
      const scrolled = agent({ action: "scroll", to: "bottom" });
      expect(scrolled.error).toBeUndefined();
      root.dispatchEvent(new Event("scroll"));

      const status = agent({ action: "scroll_status" }).scroll;
      expect(status?.bottom).toBe(true);
      expect(status?.percent).toBe(100);
      expect(status?.appeared).toBe(1);
    } finally {
      root.removeEventListener("scroll", onScroll);
      holder.remove();
      if (height) Object.defineProperty(root, "scrollHeight", height);
      if (client) Object.defineProperty(root, "clientHeight", client);
    }
  });
});

describe("mark and changes", () => {
  it("reports what changed since the mark, then clears", () => {
    agent({ action: "mark" });
    const holder = portal('<div role="status">Saved to draft</div>');

    try {
      const changes = agent({ action: "changes" }).changes ?? [];
      expect(changes.find((c) => /^status "Saved to draft" \[e\d+\]$/.test(c))).toBeDefined();
      expect(agent({ action: "changes" }).changes).toEqual([]);
    } finally {
      holder.remove();
    }
  });

  it("reports nothing when there was no mark", () => {
    expect(agent({ action: "changes" }).changes).toEqual([]);
  });
});

describe("check_wait", () => {
  it("sees text appear and go, and returns the live line that carries it", () => {
    const holder = portal('<div role="status">Saved to draft</div>');
    try {
      const found = agent({ action: "check_wait", text: "Saved to draft" });
      expect(found.met).toBe(true);
      expect(found.line).toMatch(/^status "Saved to draft" \[e\d+\]$/);
      expect(found.ref).toMatch(/^e\d+$/);

      holder.remove();
      expect(agent({ action: "check_wait", text: "Saved to draft" }).met).toBe(false);
      expect(agent({ action: "check_wait", gone: "Saved to draft" }).met).toBe(true);
    } finally {
      holder.remove();
    }
  });

  it("sees text split across inline elements", () => {
    const holder = portal('<div>Result code: <b>DLY-1</b></div>');
    try {
      const found = agent({ action: "check_wait", text: "Result code: DLY-1" });
      expect(found.met).toBe(true);
      expect(found.line).toContain("Result code: DLY-1");
      expect(found.ref).toMatch(/^e\d+$/);
    } finally {
      holder.remove();
    }
  });

  it("ignores a hidden copy until a visible one appears", () => {
    const holder = portal('<div style="display:none">Result code: DLY-2</div>');
    try {
      expect(agent({ action: "check_wait", text: "Result code: DLY-2" }).met).toBe(false);

      holder.innerHTML =
        '<div style="display:none">Result code: DLY-2</div>' +
        '<div>Result code: DLY-2</div>';
      const found = agent({ action: "check_wait", text: "Result code: DLY-2" });
      expect(found.met).toBe(true);
      expect(found.line).toContain("Result code: DLY-2");
    } finally {
      holder.remove();
    }
  });

  it("does not treat text that exists only in a hidden element as met", () => {
    const holder = portal('<div style="display:none">Ticket 42</div>');
    try {
      expect(agent({ action: "check_wait", text: "Ticket 42" }).met).toBe(false);
    } finally {
      holder.remove();
    }
  });

  it("waits for a ref to be removed or hidden", () => {
    const { container } = render(<button type="button">Go</button>);
    const tree = agent({ action: "snapshot", interactive: true }).tree ?? "";
    const ref = refOf(tree, 'button "Go"');
    const button = container.querySelector("button")!;

    expect(agent({ action: "check_wait", ref_gone: ref }).met).toBe(false);
    button.hidden = true;
    expect(agent({ action: "check_wait", ref_gone: ref }).met).toBe(true);
  });
});
