import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initialize, parse, renderDiagram } = vi.hoisted(() => ({
  initialize: vi.fn<(config: Record<string, unknown>) => void>(),
  parse: vi.fn<(code: string) => Promise<boolean>>(),
  renderDiagram: vi.fn<(id: string, code: string) => Promise<{ svg: string }>>(),
}));

vi.mock("mermaid", () => ({
  default: { initialize, parse, render: renderDiagram },
}));

import { Markdown } from "./Markdown";
import { resetMermaidCache } from "./MermaidDiagram";

const FENCE = ["```mermaid", "graph TD;", "  A-->B;", "```"].join("\n");

describe("mermaid fences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMermaidCache();
    parse.mockResolvedValue(true);
    renderDiagram.mockResolvedValue({ svg: "<svg><text>A to B</text></svg>" });
  });

  afterEach(() => resetMermaidCache());

  it("draws the diagram instead of printing its source", async () => {
    render(<Markdown>{FENCE}</Markdown>);

    await waitFor(() => expect(renderDiagram).toHaveBeenCalledTimes(1));
    expect(renderDiagram.mock.calls[0][1]).toBe("graph TD;\n  A-->B;");
    await waitFor(() => expect(document.querySelector("svg")).toBeInTheDocument());
    // Loaded on demand, and initialised once for the whole app.
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("falls back to the code block, and says it fell back", async () => {
    parse.mockRejectedValue(new Error("Parse error on line 2"));
    render(<Markdown>{FENCE}</Markdown>);

    await waitFor(() => expect(screen.getByText(/graph TD;/)).toBeInTheDocument());
    expect(renderDiagram).not.toHaveBeenCalled();
    expect(document.querySelector("svg")).toBeNull();
    // Without this line a failed render looks exactly like no mermaid support.
    expect(screen.getByText(/could not be rendered/)).toBeInTheDocument();
  });

  it("leaves an ordinary fence alone", () => {
    render(<Markdown>{"```ts\nconst a = 1;\n```"}</Markdown>);
    expect(screen.getByText(/const a = 1;/)).toBeInTheDocument();
    expect(parse).not.toHaveBeenCalled();
  });
});
