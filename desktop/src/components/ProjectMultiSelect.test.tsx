import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { ProjectSelection } from "@/lib/projectSelection";

import { ProjectMultiSelect } from "./ProjectMultiSelect";

function Harness({
  projects,
  start,
  homeEditable,
  seen,
}: {
  projects: string[];
  start: ProjectSelection;
  homeEditable?: boolean;
  seen: ProjectSelection[];
}) {
  const [value, setValue] = useState(start);
  return (
    <ProjectMultiSelect
      label="Works in"
      projects={projects}
      value={value}
      homeEditable={homeEditable}
      onChange={(next) => {
        seen.push(next);
        setValue(next);
      }}
    />
  );
}

describe("ProjectMultiSelect", () => {
  it("picks several projects, marks the first as home and lets another become home", async () => {
    const seen: ProjectSelection[] = [];
    render(
      <Harness
        projects={["api", "web", "docs"]}
        start={{ home: null, projects: [] }}
        seen={seen}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /web/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /api/ }));
    expect(seen[seen.length - 1]).toStrictEqual({ home: "web", projects: ["web", "api"] });
    expect(screen.getByText("home").closest("li")?.textContent).toContain("web");
    await userEvent.click(screen.getByRole("button", { name: "Make home" }));
    expect(seen[seen.length - 1]).toStrictEqual({ home: "api", projects: ["api", "web"] });
  });

  it("keeps a fixed home picked where it cannot move", async () => {
    const seen: ProjectSelection[] = [];
    render(
      <Harness
        projects={["api", "web"]}
        start={{ home: "api", projects: ["api"] }}
        homeEditable={false}
        seen={seen}
      />,
    );
    await userEvent.click(screen.getByRole("checkbox", { name: /api/ }));
    expect(seen).toHaveLength(0);
    await userEvent.click(screen.getByRole("checkbox", { name: /web/ }));
    expect(seen[seen.length - 1]).toStrictEqual({ home: "api", projects: ["api", "web"] });
    expect(screen.queryByRole("button", { name: "Make home" })).toBeNull();
  });

  it("filters a long list", async () => {
    const projects = ["a1", "a2", "b1", "b2", "c1", "c2", "lingoverse"];
    render(<Harness projects={projects} start={{ home: null, projects: [] }} seen={[]} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Filter projects" }), "lingo");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  });
});
