import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Snapshot } from "../../protocol";
import { ComposerHeading } from "./ComposerHeading";

const project = (name: string): Snapshot["projects"][number] =>
  ({
    agentTemplates: {},
    declaredServices: [],
    name,
    path: `/workspace/${name}`,
    portRange: [4000, 4099],
  }) as Snapshot["projects"][number];

const projects = [project("warpforge"), project("lingoverse")];

describe("ComposerHeading", () => {
  it("names the project and picks another from a searchable list", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(next: string) => void>();
    render(
      <ComposerHeading
        project="warpforge"
        projects={projects}
        locked={false}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole("heading")).toHaveTextContent("What should we build in warpforge?");
    await user.click(screen.getByRole("button", { name: "Project" }));
    await user.type(screen.getByLabelText("Search projects"), "lingo");

    expect(screen.queryByRole("menuitem", { name: /warpforge/ })).toBeNull();
    await user.click(screen.getByRole("menuitem", { name: /lingoverse/ }));
    expect(onChange).toHaveBeenCalledWith("lingoverse");
  });

  it("offers Add project, also when there are no projects yet", async () => {
    const user = userEvent.setup();
    const onAddProject = vi.fn<() => void>();
    render(
      <ComposerHeading
        project=""
        projects={[]}
        locked={false}
        onChange={vi.fn<(next: string) => void>()}
        onAddProject={onAddProject}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Project" }));
    await user.click(screen.getByRole("menuitem", { name: "Add project" }));
    expect(onAddProject).toHaveBeenCalledOnce();
  });

  it("offers No project and names the choice once it is picked", async () => {
    const user = userEvent.setup();
    const onNoProject = vi.fn<() => void>();
    const { rerender } = render(
      <ComposerHeading
        project="warpforge"
        projects={projects}
        locked={false}
        onChange={vi.fn<(next: string) => void>()}
        onNoProject={onNoProject}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Project" }));
    await user.click(screen.getByRole("menuitem", { name: "No project" }));
    expect(onNoProject).toHaveBeenCalledOnce();

    rerender(
      <ComposerHeading
        project=""
        projects={projects}
        locked={false}
        chat
        onChange={vi.fn<(next: string) => void>()}
        onNoProject={onNoProject}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe(
      "What should we explore without a project?",
    );
  });

  it("links to No project under the heading, hidden once it is picked", async () => {
    const user = userEvent.setup();
    const onNoProject = vi.fn<() => void>();
    const props = {
      onChange: vi.fn<(next: string) => void>(),
      onNoProject,
      projects,
    };
    const { rerender } = render(<ComposerHeading {...props} project="warpforge" locked={false} />);

    await user.click(screen.getByRole("button", { name: "or start without a project" }));
    expect(onNoProject).toHaveBeenCalledOnce();

    rerender(<ComposerHeading {...props} project="" locked={false} chat />);
    expect(screen.getByText("or start without a project")).toHaveClass("invisible");
  });

  it("asks without a dangling preposition when a fixed project is empty", () => {
    render(
      <ComposerHeading
        project=""
        projects={[]}
        locked
        onChange={vi.fn<(next: string) => void>()}
        onAddProject={vi.fn<() => void>()}
      />,
    );

    expect(screen.getByRole("heading").textContent).toBe("What should we build?");
  });

  it("shows a fixed project as plain text", () => {
    render(
      <ComposerHeading
        project="warpforge"
        projects={projects}
        locked
        onChange={vi.fn<(next: string) => void>()}
      />,
    );

    expect(screen.getByRole("heading").textContent).toBe("What should we build in warpforge?");
    expect(screen.queryByRole("button", { name: "Project" })).toBeNull();
  });
});
