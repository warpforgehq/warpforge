import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { setSmiths, smithFixture } from "@/test/smiths";

import { BacklogRow } from "./BacklogRow";
import type { WorkItem } from "./types";

const item: WorkItem = {
  id: "b-1",
  number: "#1",
  title: "Rework the port allocator",
  source: "local",
  project: "warpforge",
  status: "todo",
  priority: "none",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
  body: null,
  url: null,
  remoteStatus: null,
  taskId: null,
  assignee: null,
};

function renderRow(assignee: string | null) {
  return render(
    <BacklogRow
      item={{ ...item, assignee }}
      actions={{ onOpen: vi.fn<(item: WorkItem) => void>() }}
    />,
  );
}

beforeEach(() => {
  setSmiths([smithFixture()]);
});

describe("BacklogRow", () => {
  it("shows a Smith assignee by its name", () => {
    renderRow("smith:sm_1");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByText("smith:sm_1")).not.toBeInTheDocument();
  });

  it("shows a deleted Smith as a removed teammate", () => {
    renderRow("smith:sm_gone");
    expect(screen.getByText("Removed teammate")).toBeInTheDocument();
  });

  it("shows a person as written", () => {
    renderRow("lapa2112");
    expect(screen.getByText("lapa2112")).toBeInTheDocument();
  });
});
