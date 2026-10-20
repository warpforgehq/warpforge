import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "@/store/ui";

import type { FileDoc } from "../../protocol";
import { FilesSurface } from "./FilesSurface";

vi.mock("@/daemon", () => ({
  daemon: { request: () => Promise.resolve({ entries: [], truncated: false }) },
}));

vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: () => <div data-testid="editor" />,
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 28,
      })),
    scrollToIndex: vi.fn<(...args: unknown[]) => void>(),
  }),
}));

const doc: FileDoc = {
  newText: "export const x = 1;\n",
  oldText: "",
  path: "README.md",
  status: "modified",
};

function renderSurface(overrides: { fileDoc?: FileDoc | null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FilesSurface
        activeFilePath="README.md"
        editable
        fileDoc={overrides.fileDoc ?? null}
        onCloseTab={() => {}}
        onRefresh={() => {}}
        onSave={() => {}}
        onSelectTab={() => {}}
        onSelectTreeFile={() => {}}
        openTabs={[]}
        taskId="task-1"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useUi.setState({ filesPanelCollapsed: false });
});

describe("FilesSurface loading states", () => {
  it("reserves the editor with a skeleton while the document resolves", () => {
    renderSurface();

    expect(screen.getByTestId("editor-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Loading file…")).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument();
  });

  it("shows the same skeleton as the editor chunk's Suspense fallback", () => {
    renderSurface({ fileDoc: doc });

    expect(screen.getByTestId("editor-skeleton")).toBeInTheDocument();
    expect(screen.queryByText(/Loading editor/)).not.toBeInTheDocument();
  });
});
