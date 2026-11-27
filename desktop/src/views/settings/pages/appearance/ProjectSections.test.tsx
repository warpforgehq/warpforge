import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";

import { DEFAULT_PROJECT_SECTION_PREFS } from "@/lib/projectSections";
import { useUi } from "@/store/ui";

import { ProjectSections } from "./ProjectSections";

afterEach(() => useUi.setState({ projectSections: DEFAULT_PROJECT_SECTION_PREFS }));

it("hides a section from its switch", async () => {
  render(<ProjectSections />);

  await userEvent.click(screen.getByRole("switch", { name: "Show Worktrees" }));

  expect(useUi.getState().projectSections.hidden).toEqual(["worktrees"]);
  expect(screen.getByRole("switch", { name: "Show Worktrees" })).not.toBeChecked();
});

it("disables the switch of the last visible section", () => {
  useUi.setState({
    projectSections: {
      hidden: ["backlog", "pulls", "files", "runtime", "terminal"],
      order: [],
    },
  });
  render(<ProjectSections />);

  expect(screen.getByRole("switch", { name: "Show Worktrees" })).toBeDisabled();
  expect(screen.getByText("At least one section stays visible.")).toBeInTheDocument();
});

it("reorders with the up and down buttons", async () => {
  render(<ProjectSections />);

  await userEvent.click(screen.getByRole("button", { name: "Move Runtime up" }));

  const titles = screen.getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent);
  expect(titles.slice(0, 4)).toEqual(["Backlog", "Pull requests", "Runtime", "Explorer"]);
  expect(screen.getByRole("button", { name: "Move Backlog up" })).toBeDisabled();
});
