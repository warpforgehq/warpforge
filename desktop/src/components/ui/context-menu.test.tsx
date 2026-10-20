import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu";

function Harness({ onCopy, onDisabled }: { onCopy: () => void; onDisabled: () => void }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger>Chart</ContextMenuTrigger>
      <ContextMenuPortal>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onCopy}>Copy</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled onSelect={onDisabled}>
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenuPortal>
    </ContextMenu>
  );
}

describe("ContextMenu", () => {
  it("opens on contextmenu at the cursor", () => {
    render(<Harness onCopy={vi.fn<() => void>()} onDisabled={vi.fn<() => void>()} />);

    fireEvent.contextMenu(screen.getByText("Chart"), { clientX: 120, clientY: 80 });

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Copy" })).toBeInTheDocument();
  });

  it("calls the item action and closes on click", async () => {
    const onCopy = vi.fn<() => void>();
    render(<Harness onCopy={onCopy} onDisabled={vi.fn<() => void>()} />);

    fireEvent.contextMenu(screen.getByText("Chart"), { clientX: 120, clientY: 80 });
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy" }));

    expect(onCopy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("does nothing when a disabled item is clicked", async () => {
    const onDisabled = vi.fn<() => void>();
    render(<Harness onCopy={vi.fn<() => void>()} onDisabled={onDisabled} />);

    fireEvent.contextMenu(screen.getByText("Chart"), { clientX: 120, clientY: 80 });
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(onDisabled).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("renders separators", () => {
    render(<Harness onCopy={vi.fn<() => void>()} onDisabled={vi.fn<() => void>()} />);

    fireEvent.contextMenu(screen.getByText("Chart"), { clientX: 120, clientY: 80 });

    expect(screen.getByRole("separator")).toBeInTheDocument();
  });
});
