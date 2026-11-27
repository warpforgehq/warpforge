import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";

import type { TaskInfo } from "@/protocol";

import { WorkspaceFoldersChip } from "./WorkspaceFoldersChip";

const task: TaskInfo = {
  agent: "codex",
  blockedReason: null,
  createdAt: 1,
  filesChanged: 0,
  id: "t1",
  project: "api",
  prompt: "",
  status: "waiting",
  tags: [],
  title: "",
  updatedAt: 1,
};

it("lists the sibling folders the agent can see", async () => {
  render(
    <WorkspaceFoldersChip
      task={{
        ...task,
        workspaceFolders: [
          { git: true, name: "infra", path: "/work/infra" },
          { git: false, name: "schemas", path: "/work/schemas" },
        ],
      }}
    />,
  );

  await userEvent.click(screen.getByRole("button", { name: /\+2 repos/ }));
  expect(await screen.findByText("infra")).toBeInTheDocument();
  expect(screen.getByText("/work/schemas")).toBeInTheDocument();
});

it("draws nothing outside a space", () => {
  const { container } = render(<WorkspaceFoldersChip task={task} />);
  expect(container).toBeEmptyDOMElement();
});
