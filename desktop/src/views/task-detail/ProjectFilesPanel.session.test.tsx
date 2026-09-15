import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetPendingForTests, resetRegistryForTests } from "@/lib/sessionStore";

import { ProjectFilesPanel } from "./ProjectFilesPanel";

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
      files={[
        { changed: false, path: "src/a.ts" },
        { changed: false, path: "README.md" },
      ]}
      error={null}
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
});

describe("ProjectFilesPanel session writes", () => {
  it("settles after revealing the selected file instead of looping", () => {
    render(<Harness />);

    // The tree reveals the selected file's parent folder exactly once; the
    // render count stays bounded instead of hitting React's update-depth cap.
    expect(screen.getByText("src")).toBeInTheDocument();
    expect(renders).toBeLessThan(10);
  });
});
