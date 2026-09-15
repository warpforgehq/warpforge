import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { memoryStats } = vi.hoisted(() => ({
  memoryStats: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("@/daemon", () => ({
  daemon: { memoryStats, setMemoryEmbedding: vi.fn<() => Promise<unknown>>() },
}));

import MemoryPage from "./Memory";

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryPage />
    </QueryClientProvider>,
  );
}

describe("MemoryPage", () => {
  it("goes silent while stats load — no Loading… and nothing in its place", () => {
    memoryStats.mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    // The description stays empty; nothing was swapped in for the indicator.
    expect(screen.queryByText(/Hybrid: keywords|Keywords only/)).not.toBeInTheDocument();
    // The disabled select is the honest signal.
    expect(screen.getByLabelText("Embedding mode")).toBeDisabled();
  });
});
