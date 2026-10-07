import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionUpdate } from "@/protocol";

const openRenderLink = vi.fn<(taskId: string | undefined, url: string) => void>();
vi.mock("@/views/task-detail/browser/openRenderLink", () => ({ openRenderLink }));

const { HtmlRenderFrame } = await import("./HtmlRenderFrame");

const update: Extract<SessionUpdate, { kind: "html_render" }> = {
  kind: "html_render",
  render_id: "r_1",
  title: "Revenue",
  height: 300,
};

function mount() {
  render(<HtmlRenderFrame update={update} taskId="t_1" />);
  const frame = screen.getByTitle("Revenue") as HTMLIFrameElement;
  return { frame, box: frame.parentElement as HTMLElement };
}

function post(data: unknown, source: MessageEventSource | null) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source }));
  });
}

const size = (height: number) => ({
  jsonrpc: "2.0",
  method: "ui/notifications/size-changed",
  params: { height },
});
const link = {
  jsonrpc: "2.0",
  id: "wf-link-1",
  method: "ui/open-link",
  params: { url: "https://example.com/" },
};

beforeEach(() => openRenderLink.mockReset());

describe("HtmlRenderFrame", () => {
  it("is sandboxed without same-origin and themed from the first load", () => {
    const { frame } = mount();
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("src")).toMatch(/^wf-render:\/\/localhost\/t_1\/r_1\.html#wf-theme=/);
  });

  it("fits the page's height, but only as the page itself reports it", () => {
    const { frame, box } = mount();
    expect(box.style.height).toBe("300px");

    post(size(900), window);
    expect(box.style.height).toBe("300px");

    post(size(640), frame.contentWindow);
    expect(box.style.height).toBe("640px");
  });

  it("opens a link only while the frame has focus, and answers the page", () => {
    const { frame } = mount();
    const reply = vi.spyOn(frame.contentWindow as Window, "postMessage");

    post(link, frame.contentWindow);
    expect(openRenderLink).not.toHaveBeenCalled();

    frame.focus();
    post(link, window);
    expect(openRenderLink).not.toHaveBeenCalled();

    post(link, frame.contentWindow);
    expect(openRenderLink).toHaveBeenCalledWith("t_1", "https://example.com/");
    expect(reply).toHaveBeenCalledWith({ jsonrpc: "2.0", id: "wf-link-1", result: {} }, "*");
  });

  it("is a one-line summary in a compact tile", () => {
    render(<HtmlRenderFrame update={update} taskId="t_1" compact />);
    expect(screen.queryByTitle("Revenue")).toBeNull();
    expect(screen.getByText("Page · Revenue")).toBeInTheDocument();
  });
});
