import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SmithDetail } from "@/protocol";
import { smithFixture } from "@/test/smiths";

const { acceptSmithIdentity, revertSmithIdentity } = vi.hoisted(() => ({
  acceptSmithIdentity: vi.fn<(id: string) => Promise<SmithDetail>>(),
  revertSmithIdentity: vi.fn<(id: string) => Promise<SmithDetail>>(),
}));
vi.mock("@/daemon", () => ({ daemon: { acceptSmithIdentity, revertSmithIdentity } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn<() => void>() } }));

import { HeldBanner } from "./HeldBanner";

const held = smithFixture({ held: ["identity_changed", "paused"] });
const detail: SmithDetail = { charter: "", smith: smithFixture(), soul: "" };

describe("HeldBanner", () => {
  it("is absent unless the identity files were edited outside Warpforge", () => {
    render(
      <HeldBanner smith={smithFixture({ held: ["paused"] })} onResolved={vi.fn<() => void>()} />,
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the edit", async () => {
    acceptSmithIdentity.mockResolvedValue(detail);
    const onResolved = vi.fn<(detail: SmithDetail) => void>();
    render(<HeldBanner smith={held} onResolved={onResolved} />);
    expect(screen.getByRole("alert").textContent).toContain("edited outside Warpforge");
    await userEvent.click(screen.getByRole("button", { name: "Keep edit" }));
    expect(acceptSmithIdentity).toHaveBeenCalledWith("sm_1");
    expect(onResolved).toHaveBeenCalledWith(detail);
  });

  it("undoes the edit", async () => {
    revertSmithIdentity.mockResolvedValue(detail);
    render(<HeldBanner smith={held} onResolved={vi.fn<(detail: SmithDetail) => void>()} />);
    await userEvent.click(screen.getByRole("button", { name: "Undo edit" }));
    expect(revertSmithIdentity).toHaveBeenCalledWith("sm_1");
  });
});
