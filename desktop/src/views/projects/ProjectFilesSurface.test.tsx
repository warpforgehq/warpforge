import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import {
  getProjectFileRequest,
  requestProjectFile,
  resetProjectFileNav,
} from "@/lib/projectFileNav";
import { resetPendingForTests, resetRegistryForTests } from "@/lib/sessionStore";
import { useUi } from "@/store/ui";

import { ProjectFilesSurface } from "./ProjectFilesSurface";

// The editor is CodeMirror; this surface's job is which file reaches it.
vi.mock("@/components/CodeEditor", () => ({
  CodeEditor: ({
    doc,
    editable,
    gotoLocation,
  }: {
    doc: { path: string };
    editable: boolean;
    gotoLocation?: { line: number; column: number };
  }) => (
    <div data-testid="editor">
      {doc.path} {editable ? "editable" : "read-only"}
      {gotoLocation ? ` @${gotoLocation.line}:${gotoLocation.column}` : ""}
    </div>
  ),
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 28,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28 })),
    scrollToIndex: vi.fn<(...args: unknown[]) => void>(),
  }),
}));

function renderSurface() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProjectFilesSurface project="warpforge" rootPath="/workspace/warpforge" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetProjectFileNav();
  resetPendingForTests();
  resetRegistryForTests();
  useUi.setState({ filesPanelCollapsed: false });
  vi.spyOn(daemon, "request").mockImplementation(async (method: string, params?: unknown) => {
    if (method === "file.list") {
      return [
        { path: "README.md", changed: false },
        { path: "Cargo.toml", changed: false },
      ];
    }
    if (method === "file.contents") {
      const { path } = params as { path: string };
      return { path, status: "modified", oldText: "", newText: `contents of ${path}` };
    }
    return {};
  });
});

describe("ProjectFilesSurface", () => {
  it("reads the project's own checkout, with no task attached", async () => {
    renderSurface();

    expect(await screen.findByTitle("README.md")).toBeInTheDocument();
    expect(daemon.request).toHaveBeenCalledWith(
      "file.list",
      expect.objectContaining({ project: "warpforge" }),
    );
    expect(screen.getByText("No file open")).toBeInTheDocument();
  });

  it("opens a picked file in a tab and previews it read-only", async () => {
    renderSurface();

    fireEvent.click(await screen.findByTitle("README.md"));

    // The strip gains a tab for it — its close control is the part only a tab
    // has — and the file reaches the editor with write access (project files are now editable).
    expect(await screen.findByRole("button", { name: "Close README.md" })).toBeInTheDocument();
    expect(screen.queryByText("No file open")).not.toBeInTheDocument();
    expect(await screen.findByTestId("editor")).toHaveTextContent("README.md editable");
    expect(daemon.request).toHaveBeenCalledWith(
      "file.contents",
      expect.objectContaining({ path: "README.md", project: "warpforge" }),
    );
  });

  it("hides the tree when the file panel is collapsed", async () => {
    renderSurface();
    expect(await screen.findByTitle("README.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collapse file panel" }));

    await waitFor(() => expect(screen.queryByTitle("README.md")).not.toBeInTheDocument());
  });

  it("falls back to the previously opened file when a tab is closed", async () => {
    renderSurface();

    fireEvent.click(await screen.findByTitle("README.md"));
    await screen.findByTestId("editor");
    fireEvent.click(await screen.findByTitle("Cargo.toml"));
    await vi.waitFor(() =>
      expect(screen.getByTestId("editor")).toHaveTextContent("Cargo.toml editable"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Close Cargo.toml" }));

    await vi.waitFor(() =>
      expect(screen.getByTestId("editor")).toHaveTextContent("README.md editable"),
    );
  });

  it("restores open tabs when the surface remounts", async () => {
    const first = renderSurface();
    fireEvent.click(await screen.findByTitle("README.md"));
    await screen.findByRole("button", { name: "Close README.md" });
    first.unmount();

    renderSurface();

    expect(await screen.findByRole("button", { name: "Close README.md" })).toBeInTheDocument();
  });

  it("opens a file queued before the surface mounted, at its line", async () => {
    requestProjectFile({ project: "warpforge", path: "README.md", line: 7, column: 2 });

    renderSurface();

    expect(await screen.findByTestId("editor")).toHaveTextContent("README.md editable @7:2");
    expect(getProjectFileRequest()).toBeNull();
  });

  it("leaves a request addressed to another project queued", async () => {
    requestProjectFile({ project: "other", path: "README.md" });

    renderSurface();
    await screen.findByTitle("README.md");

    expect(screen.getByText("No file open")).toBeInTheDocument();
    expect(getProjectFileRequest()).toEqual({ project: "other", path: "README.md" });
  });

  it("does not share tabs between projects", async () => {
    const first = renderSurface();
    fireEvent.click(await screen.findByTitle("README.md"));
    await screen.findByRole("button", { name: "Close README.md" });
    first.unmount();

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ProjectFilesSurface project="other" rootPath="/workspace/other" />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("No file open")).toBeInTheDocument();
  });
});
