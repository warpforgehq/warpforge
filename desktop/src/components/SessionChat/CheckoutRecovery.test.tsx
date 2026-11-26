import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import { useUi } from "@/store/ui";

import { CheckoutRecovery } from "./CheckoutRecovery";

afterEach(() => {
  vi.restoreAllMocks();
  useUi.setState(useUi.getInitialState());
});

it("shows why the checkout is held and lets the user retry or open its terminal", async () => {
  const retry = vi.spyOn(daemon, "runnerRetryCheckout").mockRejectedValue(new Error("Still dirty"));
  render(<CheckoutRecovery project="warpforge" reason="The checkout has uncommitted changes." />);
  expect(screen.getByText("The checkout has uncommitted changes.")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledWith("warpforge");
  expect(await screen.findByRole("alert")).toHaveTextContent("Still dirty");

  fireEvent.click(screen.getByRole("button", { name: "Open terminal" }));
  expect(useUi.getState()).toMatchObject({
    view: "project",
    sidebarMode: "tasks",
    selectedProjectId: "warpforge",
    projectSurfaceByProject: { warpforge: "terminal" },
  });
});
