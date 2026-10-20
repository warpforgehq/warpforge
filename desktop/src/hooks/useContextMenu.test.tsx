import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MouseEvent } from "react";
import { describe, expect, it, vi } from "vitest";

import { ContextMenuProvider, useContextMenu } from "./useContextMenu";

function Row({ onAction }: { onAction: () => void }) {
  const openContextMenu = useContextMenu();
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openContextMenu({
      at: { x: e.clientX, y: e.clientY },
      items: [
        { type: "item", id: "copy", label: "Copy" },
        { type: "separator" },
        { type: "item", id: "delete", label: "Delete", disabled: true },
      ],
      handlers: new Map([["copy", onAction]]),
    });
  };
  return (
    <button type="button" onContextMenu={onContextMenu}>
      Message
    </button>
  );
}

describe("ContextMenuProvider", () => {
  it("opens the described menu and runs its handler", async () => {
    const onAction = vi.fn<() => void>();
    render(
      <ContextMenuProvider>
        <Row onAction={onAction} />
      </ContextMenuProvider>,
    );

    fireEvent.contextMenu(screen.getByText("Message"), { clientX: 40, clientY: 60 });
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});
