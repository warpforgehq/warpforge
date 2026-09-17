import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import { getProjectFileRequest, resetProjectFileNav } from "@/lib/projectFileNav";
import { ensureProject, resetPendingForTests, resetRegistryForTests } from "@/lib/sessionStore";
import { useUi } from "@/store/ui";

import { QuickOpenHost } from "./QuickOpenHost";

const PROJECT = { name: "warpforge", path: "/workspace/warpforge" };

function renderHost(project: typeof PROJECT | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuickOpenHost openTaskId={null} hasOpenTask={false} project={project} />
    </QueryClientProvider>,
  );
}

/** The double-Shift gesture the quick-open palette listens for. */
function doubleShift() {
  fireEvent.keyDown(window, { key: "Shift" });
  fireEvent.keyDown(window, { key: "Shift" });
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetProjectFileNav();
  resetPendingForTests();
  resetRegistryForTests();
  useUi.setState({ projectSurfaceByProject: {}, selectedProjectId: null, view: "control" });
  vi.spyOn(daemon, "request").mockImplementation(async (method: string) => {
    if (method === "file.list") return [{ path: "README.md", changed: false }];
    if (method === "file.search") {
      return [{ path: "src/main.rs", line: 12, column: 3, text: "fn main() {}" }];
    }
    if (method === "file.contents") return { path: "src/main.rs", newText: "fn main() {}" };
    return {};
  });
});

describe("QuickOpenHost with a project subject", () => {
  it("opens quick open on double-Shift and lists the project's files", async () => {
    renderHost(PROJECT);

    doubleShift();

    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(daemon.request).toHaveBeenCalledWith(
      "file.list",
      expect.objectContaining({ project: "warpforge" }),
    );
    expect(daemon.request).not.toHaveBeenCalledWith(
      "file.list",
      expect.objectContaining({ task_id: expect.anything() }),
    );
  });

  it("searches the project, not a task, from the quick-open query", async () => {
    renderHost(PROJECT);
    doubleShift();
    await screen.findByText("README.md");

    fireEvent.change(screen.getByLabelText("Jump to file"), { target: { value: "main" } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(daemon.request).toHaveBeenCalledWith(
      "file.search",
      expect.objectContaining({ project: "warpforge", query: "main", task_id: "" }),
    );
  });

  it("opens find in files on ⌘⇧F", async () => {
    renderHost(PROJECT);

    fireEvent.keyDown(window, { key: "F", code: "KeyF", metaKey: true, shiftKey: true });

    expect(await screen.findByLabelText("Find in files")).toBeInTheDocument();
  });

  it("seeds find in files from the project's stored session", async () => {
    const { setProjectFind } = await import("@/lib/sessionStore");
    setProjectFind(PROJECT.name, { query: "spawn", activeIndex: 2, updatedAt: 1 }, PROJECT.path);
    renderHost(PROJECT);

    fireEvent.keyDown(window, { key: "F", code: "KeyF", metaKey: true, shiftKey: true });

    expect(await screen.findByLabelText("Find in files")).toHaveValue("spawn");
  });

  it("persists the find session under the project key", async () => {
    renderHost(PROJECT);
    fireEvent.keyDown(window, { key: "F", code: "KeyF", metaKey: true, shiftKey: true });

    fireEvent.change(await screen.findByLabelText("Find in files"), {
      target: { value: "spawn" },
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(ensureProject(PROJECT.name, PROJECT.path).findInFiles?.query).toBe("spawn");
  });

  it("lands a pick on the project's Explorer surface", async () => {
    renderHost(PROJECT);
    doubleShift();

    fireEvent.mouseDown(await screen.findByText("README.md"));

    const ui = useUi.getState();
    expect(ui.view).toBe("project");
    expect(ui.selectedProjectId).toBe("warpforge");
    expect(ui.projectSurfaceByProject.warpforge).toBe("files");
    expect(getProjectFileRequest()).toEqual({ project: "warpforge", path: "README.md" });
  });

  it("carries the line and column of a text hit into the request", async () => {
    renderHost(PROJECT);
    doubleShift();
    await screen.findByText("README.md");

    fireEvent.change(screen.getByLabelText("Jump to file"), { target: { value: "main" } });
    const hit = await screen.findByRole("button", {
      name: (name) => name.includes("main.rs:12"),
    });
    fireEvent.mouseDown(hit);

    expect(getProjectFileRequest()).toEqual({
      project: "warpforge",
      path: "src/main.rs",
      line: 12,
      column: 3,
    });
  });
});

describe("QuickOpenHost with no subject", () => {
  it("ignores both shortcuts", async () => {
    renderHost(null);

    doubleShift();
    fireEvent.keyDown(window, { key: "F", code: "KeyF", metaKey: true, shiftKey: true });

    expect(screen.queryByLabelText("Jump to file")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Find in files")).not.toBeInTheDocument();
    expect(daemon.request).not.toHaveBeenCalled();
  });
});
