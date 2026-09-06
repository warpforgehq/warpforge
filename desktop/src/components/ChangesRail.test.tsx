import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import type { FileDiff } from "@/protocol";

import { ChangesRail } from "./ChangesRail";

const changedFile: FileDiff = {
  hunks: [
    {
      lines: ["-old", "+new"],
      newLines: 1,
      newStart: 1,
      oldLines: 1,
      oldStart: 1,
      resolution: null,
    },
  ],
  oldPath: null,
  path: "src/example.ts",
  status: "modified",
};

const untrackedFile: FileDiff = {
  hunks: [
    { lines: ["+fresh"], newLines: 1, newStart: 1, oldLines: 0, oldStart: 0, resolution: null },
  ],
  oldPath: null,
  path: "src/fresh.ts",
  status: "added",
};

const baseProps = {
  onCommitted: vi.fn<() => void>(),
  onRefresh: vi.fn<() => void>(),
  onSelect: vi.fn<(path: string) => void>(),
  project: "warpforge",
  selected: null,
  taskId: "task-1",
  untrackedAvailable: true,
  untrackedPaths: [] as string[],
};

/** The rail reads `git.roots` and (behind the toggle) `git.ignored`. */
function stubDaemon({
  roots = [],
  ignored = [],
  ignoredAvailable = true,
  ignoredTruncated = false,
  ignoredFails = false,
}: {
  roots?: unknown[];
  ignored?: string[];
  ignoredAvailable?: boolean;
  ignoredTruncated?: boolean;
  ignoredFails?: boolean;
} = {}) {
  return vi.spyOn(daemon, "request").mockImplementation((method: string) => {
    if (method === "git.roots") {
      return Promise.resolve({ roots });
    }
    if (method === "git.ignored") {
      if (ignoredFails) {
        return Promise.reject(new Error("repo unreadable"));
      }
      return Promise.resolve({ available: ignoredAvailable, ignored, truncated: ignoredTruncated });
    }
    if (method === "diff.get") {
      throw new Error(`unexpected diff.get in ignored test (method=${method})`);
    }
    return Promise.resolve(null);
  });
}

function renderRail(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("ChangesRail commit flow", () => {
  beforeEach(() => {
    stubDaemon();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not reserve commit space when there are no changes", () => {
    renderRail(<ChangesRail {...baseProps} files={[]} />);

    expect(screen.getByText("No changes.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /commit/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Commit message")).not.toBeInTheDocument();
  });

  it("keeps the commit form collapsed until requested", () => {
    renderRail(<ChangesRail {...baseProps} files={[changedFile]} />);

    expect(screen.queryByPlaceholderText("Commit message")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /commit/i }));
    expect(screen.getByPlaceholderText("Commit message")).toBeInTheDocument();
  });

  describe("amend", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    const openCommitBox = () => {
      renderRail(<ChangesRail {...baseProps} files={[changedFile]} />);
      fireEvent.click(screen.getByRole("button", { name: /commit/i }));
      return {
        amendBox: screen.getByRole("checkbox", { name: "amend" }),
        messageBox: screen.getByPlaceholderText("Commit message"),
      };
    };

    it("fills the box with the commit being rewritten, and clears it again", async () => {
      const read = vi
        .spyOn(daemon, "lastCommitMessage")
        .mockResolvedValue("feat: previous\n\nwith a body");
      const { amendBox, messageBox } = openCommitBox();

      fireEvent.click(amendBox);
      await waitFor(() => expect(messageBox).toHaveValue("feat: previous\n\nwith a body"));
      expect(read).toHaveBeenCalledWith("task-1");

      fireEvent.click(amendBox);
      await waitFor(() => expect(messageBox).toHaveValue(""));
    });

    it("never overwrites a message the user wrote", async () => {
      const read = vi.spyOn(daemon, "lastCommitMessage").mockResolvedValue("feat: previous");
      const { amendBox, messageBox } = openCommitBox();

      fireEvent.change(messageBox, { target: { value: "mine" } });
      fireEvent.click(amendBox);
      await waitFor(() => expect(amendBox).toBeChecked());
      expect(messageBox).toHaveValue("mine");
      expect(read).not.toHaveBeenCalled();

      // Unchecking must not throw away what the user typed either.
      fireEvent.click(amendBox);
      await waitFor(() => expect(amendBox).not.toBeChecked());
      expect(messageBox).toHaveValue("mine");
    });
  });
});

describe("ChangesRail unversioned files", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The tracked/unversioned/per-root tree itself is covered in
  // changes/changesTree.test.ts — its rows are virtualized, and jsdom gives
  // the scroll container no height, so nothing mounts to assert on here.
  it("says the unversioned scan is unavailable instead of implying there is none", () => {
    stubDaemon();

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} untrackedAvailable={false} />);

    expect(screen.getByText("Unversioned files unavailable.")).toBeInTheDocument();
  });

  it("says nothing when the scan succeeded", () => {
    stubDaemon();

    renderRail(
      <ChangesRail
        {...baseProps}
        files={[changedFile, untrackedFile]}
        untrackedPaths={[untrackedFile.path]}
      />,
    );

    expect(screen.queryByText("Unversioned files unavailable.")).not.toBeInTheDocument();
  });
});

describe("ChangesRail ignored files", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stays quiet until the toggle is on, then lists what git ignores", async () => {
    stubDaemon({ ignored: ["target/debug/app"] });

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} />);
    expect(screen.queryByText("Ignored Files")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show ignored files" }));

    // Grouped into a tree (shut by default): open the folders, the leaf
    // keeps the full path as its title.
    fireEvent.click(await screen.findByRole("button", { name: /^target/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^debug/ }));
    expect(await screen.findByTitle("target/debug/app")).toBeInTheDocument();
  });

  it("reports an empty list rather than nothing when a repo ignores no files", async () => {
    stubDaemon({ ignored: [] });

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show ignored files" }));

    expect(await screen.findByText("No ignored files.")).toBeInTheDocument();
  });

  it("says unavailable instead of empty when the scan itself failed", async () => {
    stubDaemon({ ignoredAvailable: false });

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show ignored files" }));

    expect(await screen.findByText("Ignored files unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("No ignored files.")).not.toBeInTheDocument();
  });

  it("says unavailable when the ignored request itself errors", async () => {
    stubDaemon({ ignoredFails: true });

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show ignored files" }));

    expect(await screen.findByText("Ignored files unavailable.")).toBeInTheDocument();
  });

  it("reads git.ignored, never a full diff.get, for the toggle", async () => {
    const request = stubDaemon({ ignored: ["target/debug/app"] });

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show ignored files" }));

    fireEvent.click(await screen.findByRole("button", { name: /^target/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^debug/ }));
    expect(await screen.findByTitle("target/debug/app")).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("git.ignored", { task_id: "task-1" });
    expect(request).not.toHaveBeenCalledWith(
      "diff.get",
      expect.objectContaining({ include_ignored: true }),
    );
  });

  it("renders a collapsed ignored dir as one row that cannot be expanded", async () => {
    stubDaemon({ ignored: ["apps/api/node_modules/", "apps/api/.env"] });

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show ignored files" }));

    // Shut by default: the tree is there, but nothing inside is mounted.
    expect(await screen.findByText("2 dirs and 1 file")).toBeInTheDocument();
    expect(screen.queryByText("node_modules")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^apps/ }));
    fireEvent.click(screen.getByRole("button", { name: /^api/ }));
    expect(screen.getByText("node_modules")).toBeInTheDocument();
    // Collapsed leaves are divs, not buttons — no way to expand them.
    expect(screen.getByTitle(/not expandable/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /node_modules/ })).not.toBeInTheDocument();
    // The 41,497 files inside never reach the DOM.
    expect(screen.queryByText(/dep\/f0\.js/)).not.toBeInTheDocument();
  });

  it("says the list was truncated instead of implying completeness", async () => {
    stubDaemon({ ignored: [".env"], ignoredTruncated: true });

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} />);
    fireEvent.click(screen.getByRole("button", { name: "Show ignored files" }));

    expect(await screen.findByText(/was truncated/)).toBeInTheDocument();
  });

  it("opens an ignored file in the file manager, not in the diff", async () => {
    const onOpenFile = vi.fn<(path: string) => void>();
    const onSelect = vi.fn<(path: string) => void>();
    stubDaemon({ ignored: [".env"] });

    renderRail(
      <ChangesRail
        {...baseProps}
        files={[changedFile]}
        onOpenFile={onOpenFile}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show ignored files" }));
    fireEvent.click(await screen.findByTitle(".env"));

    expect(onOpenFile).toHaveBeenCalledWith(".env");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("falls back to diff selection when no file opener is wired", async () => {
    const onSelect = vi.fn<(path: string) => void>();
    stubDaemon({ ignored: [".env"] });

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Show ignored files" }));
    fireEvent.click(await screen.findByTitle(".env"));

    expect(onSelect).toHaveBeenCalledWith(".env");
  });
});

describe("ChangesRail tabs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens on Commit and switches to Shelf and Stash", async () => {
    stubDaemon();

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} />);
    expect(screen.getByRole("tab", { name: "Commit", selected: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Shelf" }));
    expect(await screen.findByText(/No shelved changes yet/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Stash" }));
    expect(await screen.findByText(/No stash entries/)).toBeInTheDocument();
  });

  it("shelves checked files silently from the toolbar", async () => {
    const request = stubDaemon();
    const onRefresh = vi.fn<() => void>();

    renderRail(<ChangesRail {...baseProps} files={[changedFile]} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole("button", { name: "Shelve silently" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("shelf.create", {
        name: "",
        paths: ["src/example.ts"],
        task_id: "task-1",
      }),
    );
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});
