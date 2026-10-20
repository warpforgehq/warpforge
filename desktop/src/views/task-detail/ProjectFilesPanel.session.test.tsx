import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { explorerFromPaths } from "@/lib/explorerFromPaths";
import { resetPendingForTests, resetRegistryForTests } from "@/lib/sessionStore";

import { ProjectFilesPanel } from "./ProjectFilesPanel";

const { request } = vi.hoisted(() => ({
  request: vi.fn<(method: string, params: unknown) => Promise<unknown>>(),
}));
vi.mock("@/daemon", () => ({ daemon: { request } }));

// The virtualizer only affects rendering, not the reveal-effect contract this
// test pins; mocking it keeps the test deterministic under jsdom.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28 })),
    scrollToIndex: vi.fn<(...args: unknown[]) => void>(),
  }),
}));

let renders = 0;

/**
 * Mirrors how the session layer feeds expansion back into the panel: the
 * callback updates state, which re-renders the panel. If the panel writes back
 * on every render, this is an unbounded update loop.
 */
function Harness() {
  renders += 1;
  const [expandedDirs, setExpandedDirs] = useState<string[]>([]);
  return (
    <ProjectFilesPanel
      taskId="t1"
      selected="src/a.ts"
      onSelect={() => {}}
      treeState={{
        expandedDirs,
        onChange: (next) => setExpandedDirs(next.expandedDirs),
        scrollLeft: 0,
        scrollTop: 0,
      }}
    />
  );
}

beforeEach(() => {
  renders = 0;
  resetPendingForTests();
  resetRegistryForTests();
  request.mockImplementation(explorerFromPaths(["src/a.ts", "README.md"]));
});

describe("ProjectFilesPanel session writes", () => {
  it("settles after revealing the selected file instead of looping", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    // The tree reveals the selected file's parent folder exactly once; the
    // render count stays bounded instead of hitting React's update-depth cap.
    expect(await screen.findByText("a.ts")).toBeInTheDocument();
    expect(renders).toBeLessThan(10);
  });
});
