import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon } from "../../daemon";
import type { FileDiff, StashEntry } from "../../protocol";
import { StashTab } from "./StashTab";

const entry: StashEntry = {
  branch: "main",
  createdAt: 1_786_780_800,
  files: ["src/a.ts"],
  id: "stash@{0}",
  message: "wip",
};

const stashedFile: FileDiff = {
  hunks: [
    {
      lines: ["-two", "+TWO"],
      newLines: 1,
      newStart: 2,
      oldLines: 1,
      oldStart: 2,
      resolution: null,
    },
  ],
  oldPath: null,
  path: "src/a.ts",
  status: "modified",
};

function stubStash(entries: StashEntry[] = [entry]) {
  return vi.spyOn(daemon, "request").mockImplementation((method: string) => {
    if (method === "stash.list") {
      return Promise.resolve({ entries });
    }
    if (method === "stash.get") {
      return Promise.resolve({ entry: entries[0], files: [stashedFile] });
    }
    return Promise.resolve(null);
  });
}

function renderTab(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("StashTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists entries and previews the selected one's diff", async () => {
    stubStash();

    renderTab(<StashTab taskId="task-1" onRefresh={vi.fn<() => void>()} />);

    expect(await screen.findByText("wip")).toBeInTheDocument();
    expect(screen.getByText(/stash@\{0\}/)).toBeInTheDocument();
    expect(await screen.findByText("Stashed Files")).toBeInTheDocument();
    expect(await screen.findByText("-two")).toBeInTheDocument();
    expect(screen.getByText("+TWO")).toBeInTheDocument();
  });

  it("says so when the stash is empty", async () => {
    stubStash([]);

    renderTab(<StashTab taskId="task-1" onRefresh={vi.fn<() => void>()} />);

    expect(await screen.findByText(/No stash entries/)).toBeInTheDocument();
  });

  it("applies keeping the entry, applies-and-drops on demand", async () => {
    const request = stubStash();
    const onRefresh = vi.fn<() => void>();

    renderTab(<StashTab taskId="task-1" onRefresh={onRefresh} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply stash@{0}" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("stash.apply", {
        id: "stash@{0}",
        pop: false,
        task_id: "task-1",
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "Apply and drop stash@{0}" }));
    expect(await screen.findByText("Apply & Drop stash@{0}")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply & Drop" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("stash.apply", {
        id: "stash@{0}",
        pop: true,
        task_id: "task-1",
      }),
    );
  });

  it("restores a single file out of the entry", async () => {
    const request = stubStash();
    const onRefresh = vi.fn<() => void>();

    renderTab(<StashTab taskId="task-1" onRefresh={onRefresh} />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore this file" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("stash.file", {
        id: "stash@{0}",
        paths: ["src/a.ts"],
        task_id: "task-1",
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("drops the entry only after confirmation", async () => {
    const request = stubStash();

    renderTab(<StashTab taskId="task-1" onRefresh={vi.fn<() => void>()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Drop stash@{0}" }));

    expect(await screen.findByText("Drop stash@{0}")).toBeInTheDocument();
    expect(request).not.toHaveBeenCalledWith("stash.drop", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Drop entry" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("stash.drop", {
        id: "stash@{0}",
        task_id: "task-1",
      }),
    );
  });
});
