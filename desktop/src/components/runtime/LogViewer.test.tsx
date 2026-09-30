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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./TerminalWorkspace", () => ({
  TerminalWorkspaceView: () => null,
}));

import { daemon } from "../../daemon";
import type { LogEntry } from "../../daemon/types";
import type { ServiceInfo } from "../../protocol";
import type { ContextChip } from "../Composer";
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

function mockSelection(
  text: string,
  container: HTMLElement,
  rect: DOMRect,
  range: Range = document.createRange(),
) {
  if (range.collapsed) range.selectNodeContents(container);
  const sel = {
    isCollapsed: text.length === 0,
    rangeCount: text.length > 0 ? 1 : 0,
    toString: () => text,
    getRangeAt: () => range,
    removeAllRanges: vi.fn<() => void>(),
  } as unknown as Selection;
  Object.defineProperty(range, "getBoundingClientRect", { value: () => rect });
  Object.defineProperty(range, "commonAncestorContainer", {
    value: container,
  });
  document.getSelection = () => sel;
  return sel;
}

describe("LogViewer — selection toolbar", () => {
  let origGetSelection: typeof document.getSelection;
  let origClipboard: typeof navigator.clipboard;

  beforeEach(() => {
    origGetSelection = document.getSelection.bind(document);
    origClipboard = navigator.clipboard;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    document.getSelection = origGetSelection;
    Object.defineProperty(navigator, "clipboard", {
      value: origClipboard,
      writable: true,
      configurable: true,
    });
  });

  it("no toolbar when no selection", () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("some log line"));
    render(<RuntimePanel project="warpforge" services={[webService]} portforwards={[]} />);
    expect(screen.queryByRole("button", { name: /copy/i })).not.toBeInTheDocument();
  });

  it("toolbar appears with Copy and Add to chat when text is selected", async () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("selected text here"));
    render(
      <RuntimePanel
        project="warpforge"
        services={[webService]}
        portforwards={[]}
        onAppendToChat={vi.fn<(context: ContextChip) => void>()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("selected text here")).toBeInTheDocument();
    });
    const logEl = screen.getByText("selected text here");
    const container = logEl.closest('[class*="overflow-y-auto"]') as HTMLElement;
    mockSelection("selected text here", container, new DOMRect(10, 10, 100, 20));
    fireEvent(document, new Event("selectionchange"));
    expect(screen.getByRole("button", { name: /copy selected log text/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add selected log text to chat/i }),
    ).toBeInTheDocument();
  });

  it("Copy copies exact selected text and shows feedback", async () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("exact log content"));
    render(
      <RuntimePanel
        project="warpforge"
        services={[webService]}
        portforwards={[]}
        onAppendToChat={vi.fn<(context: ContextChip) => void>()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("exact log content")).toBeInTheDocument();
    });
    const logEl = screen.getByText("exact log content");
    const container = logEl.closest('[class*="overflow-y-auto"]') as HTMLElement;
    mockSelection("exact log content", container, new DOMRect(10, 10, 100, 20));
    fireEvent(document, new Event("selectionchange"));
    fireEvent.click(screen.getByRole("button", { name: /copy selected log text/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("exact log content");
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
  });

  it("Copy shows failure feedback on clipboard rejection", async () => {
    (navigator.clipboard.writeText as any).mockRejectedValueOnce(new Error("denied"));
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("text"));
    render(
      <RuntimePanel
        project="warpforge"
        services={[webService]}
        portforwards={[]}
        onAppendToChat={vi.fn<(context: ContextChip) => void>()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("text")).toBeInTheDocument();
    });
    const logEl = screen.getByText("text");
    const container = logEl.closest('[class*="overflow-y-auto"]') as HTMLElement;
    mockSelection("text", container, new DOMRect(10, 10, 100, 20));
    fireEvent(document, new Event("selectionchange"));
    fireEvent.click(screen.getByRole("button", { name: /copy selected log text/i }));
    await waitFor(() => {
      expect(screen.getByText("Copy failed")).toBeInTheDocument();
    });
  });

  async function selectAllLogs(firstLine: string) {
    await waitFor(() => {
      expect(screen.getByText(firstLine)).toBeInTheDocument();
    });
    const container = screen
      .getByText(firstLine)
      .closest('[class*="overflow-y-auto"]') as HTMLElement;
    mockSelection(container.textContent ?? "", container, new DOMRect(10, 10, 100, 20));
    fireEvent(document, new Event("selectionchange"));
  }

  it("Add to chat attaches a chip with the selected seq range, does not submit", async () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue([
      { at: Date.UTC(2026, 8, 30, 12, 0, 1), line: "boot", seq: 1234 },
      { at: Date.UTC(2026, 8, 30, 12, 0, 7), line: "crash", seq: 1235 },
    ]);
    const onAppendToChat = vi.fn<(context: ContextChip) => void>();
    render(
      <RuntimePanel
        project="warpforge"
        services={[webService]}
        portforwards={[]}
        onAppendToChat={onAppendToChat}
      />,
    );
    await selectAllLogs("boot");
    fireEvent.click(screen.getByRole("button", { name: /add selected log text to chat/i }));
    expect(onAppendToChat).toHaveBeenCalledTimes(1);
    const chip = onAppendToChat.mock.calls[0][0];
    expect(chip.label).toBe("service:web seq 1234–1235");
    expect(chip.body).toBe(
      [
        "service:web seq 1234–1235 (2026-09-30 12:00:01–12:00:07 UTC)",
        "```",
        "boot",
        "crash",
        "```",
        'Surrounding lines: read_service_logs(service: "web", after: 1214, before: 1256)',
      ].join("\n"),
    );
  });

  it("a selection ending at the start of the next line leaves that line out", async () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("one", "two", "three"));
    const onAppendToChat = vi.fn<(context: ContextChip) => void>();
    render(
      <RuntimePanel
        project="warpforge"
        services={[webService]}
        portforwards={[]}
        onAppendToChat={onAppendToChat}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("two")).toBeInTheDocument();
    });
    const container = screen.getByText("two").closest('[class*="overflow-y-auto"]') as HTMLElement;
    const range = document.createRange();
    range.setStart(screen.getByText("two").firstChild!, 1);
    range.setEnd(screen.getByText("three").firstChild!, 0);
    mockSelection("wo\n", container, new DOMRect(10, 10, 100, 20), range);
    fireEvent(document, new Event("selectionchange"));
    fireEvent.click(screen.getByRole("button", { name: /add selected log text to chat/i }));
    expect(onAppendToChat.mock.calls[0][0].label).toBe("service:web seq 1");
  });

  it("⌘L on a log selection attaches the chip", async () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("only line"));
    const onAppendToChat = vi.fn<(context: ContextChip) => void>();
    render(
      <RuntimePanel
        project="warpforge"
        services={[webService]}
        portforwards={[]}
        onAppendToChat={onAppendToChat}
      />,
    );
    await selectAllLogs("only line");
    fireEvent.keyDown(document, { key: "l", metaKey: true });
    expect(onAppendToChat).toHaveBeenCalledTimes(1);
    expect(onAppendToChat.mock.calls[0][0].label).toBe("service:web seq 0");
  });

  it("Send last failure attaches the newest lines of a failed service", () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue([]);
    vi.spyOn(daemon, "getState").mockReturnValue({
      ...daemon.getState(),
      serviceLogs: { "warpforge/web": logEntries("starting", "panic: boom") },
    });
    const onAppendToChat = vi.fn<(context: ContextChip) => void>();
    render(
      <RuntimePanel
        project="warpforge"
        services={[{ ...webService, status: "failed" }]}
        portforwards={[]}
        onAppendToChat={onAppendToChat}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /send last failure/i }));
    const chip = onAppendToChat.mock.calls[0][0];
    expect(chip.label).toBe("service:web seq 0–1");
    expect(chip.body).toContain("panic: boom");
  });

  it("selection outside log viewer does not show toolbar", async () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("log line"));
    render(<RuntimePanel project="warpforge" services={[webService]} portforwards={[]} />);
    await waitFor(() => {
      expect(screen.getByText("log line")).toBeInTheDocument();
    });
    mockSelection("outside text", document.body, new DOMRect(10, 10, 100, 20));
    fireEvent(document, new Event("selectionchange"));
    expect(
      screen.queryByRole("button", { name: /copy selected log text/i }),
    ).not.toBeInTheDocument();
  });

  it("collapsed selection does not show toolbar", async () => {
    vi.spyOn(daemon, "fetchServiceLogs").mockResolvedValue(logEntries("log line"));
    render(<RuntimePanel project="warpforge" services={[webService]} portforwards={[]} />);
    await waitFor(() => {
      expect(screen.getByText("log line")).toBeInTheDocument();
    });
    const logEl = screen.getByText("log line");
    const container = logEl.closest('[class*="overflow-y-auto"]') as HTMLElement;
    const sel = mockSelection("", container, new DOMRect(10, 10, 0, 0));
    (sel as any).isCollapsed = true;
    (sel as any).rangeCount = 0;
    fireEvent(document, new Event("selectionchange"));
    expect(
      screen.queryByRole("button", { name: /copy selected log text/i }),
    ).not.toBeInTheDocument();
  });
});
