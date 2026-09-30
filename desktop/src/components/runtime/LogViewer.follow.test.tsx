vi.mock("@xterm/xterm", () => {
  const MockTerminal = function () {
    const element = document.createElement("div");
    return {
      element,
      loadAddon: vi.fn<(addon: unknown) => void>(),
      onData: vi
        .fn<(cb: (data: string) => void) => { dispose: () => void }>()
        .mockReturnValue({ dispose: vi.fn<() => void>() }),
      dispose: vi.fn<() => void>(),
      focus: vi.fn<() => void>(),
      open: vi.fn<(host: HTMLElement) => void>((host) => host.appendChild(element)),
      write: vi.fn<(data: Uint8Array | string) => void>(),
      cols: 80,
      rows: 24,
    };
  };
  return { Terminal: MockTerminal };
});
vi.mock("@xterm/addon-fit", () => {
  const MockFitAddon = function () {
    return { fit: vi.fn<() => void>() };
  };
  return { FitAddon: MockFitAddon };
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./TerminalWorkspace", () => ({
  TerminalWorkspaceView: () => null,
}));

import { daemon } from "../../daemon";
import type { LogEntry } from "../../daemon/types";
import type { ServiceInfo } from "../../protocol";
import { RuntimePanel } from "../RuntimePanel";

const webService: ServiceInfo = {
  allocatedPort: 4000,
  command: "bun run dev",
  logSeq: 0,
  name: "web",
  originalPort: 3000,
  project: "warpforge",
  status: "running",
};

afterEach(() => {
  vi.restoreAllMocks();
});

const logEntries = (...lines: string[]): LogEntry[] =>
  lines.map((line, seq) => ({ at: 0, line, seq }));

describe("LogViewer — auto-follow", () => {
  function makeScrollable(container: HTMLElement, scrollTop = 0) {
    Object.defineProperty(container, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 200,
      configurable: true,
    });
    Object.defineProperty(container, "scrollTop", {
      value: scrollTop,
      writable: true,
      configurable: true,
    });
  }

  it("Jump-to-latest is hidden initially when following", async () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("line1"));
    render(<RuntimePanel project="warpforge" services={[webService]} portforwards={[]} />);
    await waitFor(() => {
      expect(screen.getByText("line1")).toBeInTheDocument();
    });
    expect(screen.queryByLabelText("Jump to latest log line")).not.toBeInTheDocument();
  });

  it("Jump to latest hides after click", async () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("line1"));
    render(<RuntimePanel project="warpforge" services={[webService]} portforwards={[]} />);
    await waitFor(() => {
      expect(screen.getByText("line1")).toBeInTheDocument();
    });
    const container = screen
      .getByText("line1")
      .closest('[class*="overflow-y-auto"]') as HTMLElement;
    makeScrollable(container, 100);
    fireEvent.scroll(container);
    await waitFor(() => {
      expect(screen.getByLabelText("Jump to latest log line")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByLabelText("Jump to latest log line"));
    expect(screen.queryByLabelText("Jump to latest log line")).not.toBeInTheDocument();
  });

  it("scrolling back to bottom hides jump button", async () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("line1"));
    render(<RuntimePanel project="warpforge" services={[webService]} portforwards={[]} />);
    await waitFor(() => {
      expect(screen.getByText("line1")).toBeInTheDocument();
    });
    const container = screen
      .getByText("line1")
      .closest('[class*="overflow-y-auto"]') as HTMLElement;
    makeScrollable(container, 100);
    fireEvent.scroll(container);
    await waitFor(() => {
      expect(screen.getByLabelText("Jump to latest log line")).toBeInTheDocument();
    });
    makeScrollable(container, 800);
    fireEvent.scroll(container);
    expect(screen.queryByLabelText("Jump to latest log line")).not.toBeInTheDocument();
  });

  it("new log appended while scrolled up does not yank to bottom", async () => {
    const logStore: Record<string, LogEntry[]> = {
      "warpforge/web": logEntries("line1"),
    };
    vi.spyOn(daemon, "getState").mockReturnValue({
      ...daemon.getState(),
      serviceLogs: logStore,
    });
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue([]);

    let subscriber: (() => void) | null = null;
    vi.spyOn(daemon, "subscribe").mockImplementation((fn: () => void) => {
      subscriber = fn;
      return () => {};
    });

    render(<RuntimePanel project="warpforge" services={[webService]} portforwards={[]} />);
    await waitFor(() => {
      expect(screen.getByText("line1")).toBeInTheDocument();
    });

    const container = screen
      .getByText("line1")
      .closest('[class*="overflow-y-auto"]') as HTMLElement;
    makeScrollable(container, 100);
    fireEvent.scroll(container);

    const scrollTopBefore = container.scrollTop;
    logStore["warpforge/web"] = logEntries("line1", "line2");
    act(() => {
      subscriber!();
    });

    expect(screen.getByText("line2")).toBeInTheDocument();
    expect(container.scrollTop).toBe(scrollTopBefore);
    expect(screen.getByLabelText("Jump to latest log line")).toBeInTheDocument();
  });

  it("after resuming follow, new log appends scroll to bottom", async () => {
    const logStore: Record<string, LogEntry[]> = {
      "warpforge/web": logEntries("line1"),
    };
    vi.spyOn(daemon, "getState").mockReturnValue({
      ...daemon.getState(),
      serviceLogs: logStore,
    });
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue([]);

    let subscriber: (() => void) | null = null;
    vi.spyOn(daemon, "subscribe").mockImplementation((fn: () => void) => {
      subscriber = fn;
      return () => {};
    });

    render(<RuntimePanel project="warpforge" services={[webService]} portforwards={[]} />);
    await waitFor(() => {
      expect(screen.getByText("line1")).toBeInTheDocument();
    });

    const container = screen
      .getByText("line1")
      .closest('[class*="overflow-y-auto"]') as HTMLElement;

    makeScrollable(container, 800);
    fireEvent.scroll(container);

    logStore["warpforge/web"] = logEntries("line1", "line2");
    act(() => {
      subscriber!();
    });

    await waitFor(() => {
      expect(screen.getByText("line2")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(container.scrollTop).toBeGreaterThan(800);
    });
  });
});
