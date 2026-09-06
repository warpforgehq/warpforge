import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon } from "../../daemon";
import { useUi } from "../../store/ui";
import { ShelveDialog } from "./ShelveDialog";

describe("ShelveDialog", () => {
  afterEach(() => {
    useUi.getState().setTextGenAgentId(null);
    vi.restoreAllMocks();
  });

  it("renders nothing without paths", () => {
    const { container } = render(
      <ShelveDialog mode="shelf" paths={null} taskId="task-1" onClose={vi.fn<() => void>()} onShelved={vi.fn<() => void>()} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shelves under the typed name and closes", async () => {
    const request = vi.spyOn(daemon, "request").mockResolvedValue(null);
    const onShelved = vi.fn<() => void>();

    render(
      <ShelveDialog
        mode="shelf"
        paths={["src/a.ts", "new.txt"]}
        taskId="task-1"
        onClose={vi.fn<() => void>()}
        onShelved={onShelved}
      />,
    );

    expect(screen.getByText("Shelve 2 files")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Shelf name" }), {
      target: { value: "wip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Shelve" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("shelf.create", {
        name: "wip",
        paths: ["src/a.ts", "new.txt"],
        task_id: "task-1",
      }),
    );
    await waitFor(() => expect(onShelved).toHaveBeenCalled());
  });

  it("stashes under the typed message in stash mode", async () => {
    const request = vi.spyOn(daemon, "request").mockResolvedValue(null);
    const onShelved = vi.fn<() => void>();

    render(
      <ShelveDialog
        mode="stash"
        paths={["src/a.ts"]}
        taskId="task-1"
        onClose={vi.fn<() => void>()}
        onShelved={onShelved}
      />,
    );

    expect(screen.getByText("Stash 1 file")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Stash message" }), {
      target: { value: "wip" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stash" }));

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("stash.push", {
        message: "wip",
        paths: ["src/a.ts"],
        task_id: "task-1",
      }),
    );
    await waitFor(() => expect(onShelved).toHaveBeenCalled());
  });

  it("drafts the name from the diff with the magic button", async () => {
    useUi.getState().setTextGenAgentId("agent-1");
    vi.spyOn(daemon, "request").mockResolvedValue(null);
    const generate = vi
      .spyOn(daemon, "generateText")
      .mockResolvedValue("Add filtering\n\nwith a body");

    render(
      <ShelveDialog mode="shelf" paths={["src/a.ts"]} taskId="task-1" onClose={vi.fn<() => void>()} onShelved={vi.fn<() => void>()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft shelf name" }));

    await waitFor(() =>
      expect(generate).toHaveBeenCalledWith("task-1", expect.anything(), "shelf_name", undefined, {
        input: "src/a.ts",
      }),
    );
    // First line only — a shelf name is one line.
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Shelf name" })).toHaveValue("Add filtering"),
    );
  });
});
