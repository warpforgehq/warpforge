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

  it("shows a fixed project as plain text", () => {
    render(
      <ComposerHeading
        project="warpforge"
        projects={projects}
        locked
        onChange={vi.fn<(next: string) => void>()}
      />,
    );

    expect(screen.getByRole("heading")).toHaveTextContent("What should we build in warpforge?");
    expect(screen.queryByRole("button", { name: "Project" })).toBeNull();
  });
});
