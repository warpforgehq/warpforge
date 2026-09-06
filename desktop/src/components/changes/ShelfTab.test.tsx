import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon } from "../../daemon";
import type { FileDiff, ShelfEntry } from "../../protocol";
import { ShelfTab } from "./ShelfTab";

const entry: ShelfEntry = {
  branch: "main",
  createdAt: 1_786_780_800,
  deletedFiles: ["gone.txt"],
  files: ["src/a.ts", "new.txt"],
  id: "abc123",
  name: "wip",
};

const shelvedFile: FileDiff = {
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

function stubShelf(entries: ShelfEntry[] = [entry]) {
  return vi.spyOn(daemon, "request").mockImplementation((method: string) => {
    if (method === "shelf.list") {
      return Promise.resolve({ entries });
    }
    if (method === "shelf.get") {
      return Promise.resolve({ entry: entries[0], files: [shelvedFile] });
    }
    return Promise.resolve(null);
  });
}

function renderTab(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("ShelfTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists bundles and previews the selected one's diff", async () => {
    stubShelf();

    renderTab(<ShelfTab taskId="task-1" onRefresh={vi.fn<() => void>()} />);

    expect(await screen.findByText("wip")).toBeInTheDocument();
    expect(screen.getByText(/main · 2 files/)).toBeInTheDocument();
    // Files of the selected bundle, grouped; preview shows the hunks.
    expect(await screen.findByText("Shelved Files")).toBeInTheDocument();
    expect(await screen.findByText("-two")).toBeInTheDocument();
    expect(screen.getByText("+TWO")).toBeInTheDocument();
  });

  it("says so when the shelf is empty", async () => {
    stubShelf([]);

    renderTab(<ShelfTab taskId="task-1" onRefresh={vi.fn<() => void>()} />);

    expect(await screen.findByText(/No shelved changes yet/)).toBeInTheDocument();
  });

  it("lists recently deleted files under the bundle", async () => {
    stubShelf();

    renderTab(<ShelfTab taskId="task-1" onRefresh={vi.fn<() => void>()} />);
    fireEvent.click(await screen.findByText("wip"));

    expect(await screen.findByText("Recently Deleted")).toBeInTheDocument();
    expect(screen.getByTitle("gone.txt")).toBeInTheDocument();
  });

  it("applies keeping the entry and refreshes the Commit tab", async () => {
    const request = stubShelf();
    const onRefresh = vi.fn<() => void>();

    renderTab(<ShelfTab taskId="task-1" onRefresh={onRefresh} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply wip" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("shelf.apply", {
        drop: false,
        id: "abc123",
        task_id: "task-1",
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("applies and drops the entry after confirmation", async () => {
    const request = stubShelf();
    const onRefresh = vi.fn<() => void>();

    renderTab(<ShelfTab taskId="task-1" onRefresh={onRefresh} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply and drop wip" }));

    // The confirm dialog names the entry and lists its files; nothing fires yet.
    expect(await screen.findByText('Apply & Drop "wip"')).toBeInTheDocument();
    expect(request).not.toHaveBeenCalledWith("shelf.apply", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Apply & Drop" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("shelf.apply", {
        drop: true,
        id: "abc123",
        task_id: "task-1",
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });

  it("deletes the bundle only after confirmation", async () => {
    const request = stubShelf();

    renderTab(<ShelfTab taskId="task-1" onRefresh={vi.fn<() => void>()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete wip" }));

    expect(await screen.findByText('Delete "wip"')).toBeInTheDocument();
    expect(request).not.toHaveBeenCalledWith("shelf.drop", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "Delete entry" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("shelf.drop", {
        id: "abc123",
        task_id: "task-1",
      }),
    );
  });

  it("does nothing when the confirm dialog is cancelled", async () => {
    const request = stubShelf();

    renderTab(<ShelfTab taskId="task-1" onRefresh={vi.fn<() => void>()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Apply and drop wip" }));
    expect(await screen.findByText('Apply & Drop "wip"')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByText('Apply & Drop "wip"')).not.toBeInTheDocument(),
    );
    expect(request).not.toHaveBeenCalledWith("shelf.apply", expect.anything());
  });

  it("selects nothing when the picked entry vanishes instead of substituting", async () => {
    const other: ShelfEntry = { ...entry, id: "def456", name: "other" };
    stubShelf([entry, other]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ShelfTab taskId="task-1" onRefresh={vi.fn<() => void>()} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByText("other"));
    expect(screen.getByRole("button", { name: "Apply other" })).toBeInTheDocument();

    act(() => {
      client.setQueryData(["shelfList", "task-1"], { entries: [entry] });
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Apply shelf entry" })).toBeDisabled(),
    );
    expect(screen.queryByText("Shelved Files")).not.toBeInTheDocument();
  });
});
