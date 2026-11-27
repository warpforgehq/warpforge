import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import { SettingsNav } from "@/components/Sidebar/SettingsNav";
import type { Snapshot } from "@/protocol";
import { useUi } from "@/store/ui";

import SettingsView from ".";
import { searchSettings } from "./search";

const snapshot: Snapshot = {
  portforwards: [],
  projects: [],
  services: [],
  tasks: [],
  terminals: [],
};

afterEach(() => {
  useUi.getState().setSettingsPage("appearance");
});

it.each([true, false])(
  "opens and highlights a search result with fallback navigation %s",
  async (showNav) => {
    const scroll = vi.fn<() => void>();
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scroll,
    });
    try {
      const user = userEvent.setup();
      render(
        <>
          {!showNav && <SettingsNav />}
          <SettingsView
            showNav={showNav}
            snapshot={snapshot}
            onClose={() => {}}
            onOpenTask={() => {}}
          />
        </>,
      );

      expect(screen.getByText("Personal")).toBeVisible();
      await user.type(screen.getByRole("searchbox", { name: "Search settings" }), "macos banner");
      await user.click(screen.getByRole("button", { name: /macOS notification on task finish/i }));

      const row = screen
        .getByRole("heading", { name: "macOS notification on task finish" })
        .closest("[data-highlighted]");
      expect(row).toHaveAttribute("id", "native-task-finished");
      expect(row).toHaveFocus();
      expect(scroll).toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Notifications" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", original);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  },
);

it("has no Models page and finds model settings on the agent list", () => {
  render(<SettingsNav />);
  expect(screen.queryByRole("button", { name: "Models" })).not.toBeInTheDocument();
  expect(searchSettings("custom model").map((row) => [row.page, row.id])).toEqual([
    ["agents", "agent-setup"],
  ]);
});
