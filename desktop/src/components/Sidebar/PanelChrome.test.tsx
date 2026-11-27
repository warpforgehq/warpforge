import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { PanelHeader } from "./PanelChrome";

it("titles a panel in sentence case without a back control", () => {
  render(<PanelHeader title="Smiths" />);

  const title = screen.getByRole("heading", { name: "Smiths", level: 2 });
  expect(title.className).toContain("text-[1rem]");
  expect(title.className).not.toContain("uppercase");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

it("gives Settings the same title with a back chevron", async () => {
  const onBack = vi.fn<() => void>();
  render(<PanelHeader title="Settings" onBack={onBack} />);

  expect(screen.getByRole("heading", { name: "Settings", level: 2 }).className).toContain(
    "text-[1rem]",
  );
  await userEvent.click(screen.getByRole("button", { name: "Back from Settings" }));
  expect(onBack).toHaveBeenCalled();
});
