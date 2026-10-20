import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MouseEvent } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { ContextMenuProvider, useContextMenu } from "./useContextMenu";

// jsdom's DOMRect.fromRect drops x/y, which leaves Floating UI anchoring every
// menu at (0,0) and makes position assertions meaningless.
beforeAll(() => {
  vi.spyOn(DOMRect, "fromRect").mockImplementation((rect = {}) => {
    const x = rect.x ?? 0;
    const y = rect.y ?? 0;
    const width = rect.width ?? 0;
    const height = rect.height ?? 0;
    return {
      x,
      y,
      width,
      height,
      left: x,
      top: y,
      right: x + width,
      bottom: y + height,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});

function Row({ label, item, onAction }: { label: string; item: string; onAction: () => void }) {
  const openContextMenu = useContextMenu();
  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    openContextMenu({
      at: { x: e.clientX, y: e.clientY },
      items: [{ type: "item", id: item.toLowerCase(), label: item }],
      handlers: new Map([[item.toLowerCase(), onAction]]),
    });
  };
  return (
    <button type="button" onContextMenu={onContextMenu}>
      {label}
    </button>
  );
}

async function expectAnchoredAt(x: number, y: number) {
  const wrapper = screen.getByRole("menu").parentElement;
  expect(wrapper).not.toBeNull();
  await waitFor(() => {
    const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(wrapper!.style.transform);
    expect(match).not.toBeNull();
    expect(Math.abs(Number(match![1]) - x)).toBeLessThan(4);
    expect(Math.abs(Number(match![2]) - y)).toBeLessThan(4);
  });
}

describe("ContextMenuProvider", () => {
  it("opens the described menu at the cursor and runs its handler", async () => {
    const onAction = vi.fn<() => void>();
    render(
      <ContextMenuProvider>
        <Row label="Message" item="Copy" onAction={onAction} />
      </ContextMenuProvider>,
    );

    fireEvent.contextMenu(screen.getByText("Message"), { clientX: 120, clientY: 80 });

    await expectAnchoredAt(120, 80);
    await expect(screen.getByRole("menuitem", { name: "Copy" })).toBeInTheDocument();
    expect(document.body.style.pointerEvents).not.toBe("none");

    fireEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("re-anchors and swaps items when another row is right-clicked while open", async () => {
    render(
      <ContextMenuProvider>
        <Row label="Message" item="Copy" onAction={vi.fn<() => void>()} />
        <Row label="Branch" item="Rename" onAction={vi.fn<() => void>()} />
      </ContextMenuProvider>,
    );

    fireEvent.contextMenu(screen.getByText("Message"), { clientX: 120, clientY: 80 });
    await expectAnchoredAt(120, 80);

    fireEvent.contextMenu(screen.getByText("Branch"), { clientX: 300, clientY: 200 });

    await expectAnchoredAt(300, 200);
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Copy" })).not.toBeInTheDocument();
    expect(document.body.style.pointerEvents).not.toBe("none");
  });
});
