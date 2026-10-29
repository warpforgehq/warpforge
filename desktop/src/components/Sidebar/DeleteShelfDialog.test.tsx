import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DeleteShelfDialog } from "./DeleteShelfDialog";

const shelf = (project: string) => ({
  count: 2,
  deletableIds: ["a", "b"],
  expanded: false,
  key: `shelf:${project}`,
  keptCount: 0,
  kind: "shelf" as const,
  project,
});

describe("DeleteShelfDialog", () => {
  it("says a chat holding files survives the Chats shelf's delete", () => {
    render(
      <DeleteShelfDialog
        row={shelf("")}
        onCancel={vi.fn<() => void>()}
        onConfirm={vi.fn<(project: string) => Promise<void>>()}
      />,
    );
    expect(screen.getByText(/Delete 2 finished chats\?/)).toHaveTextContent(
      "A chat whose folder still holds files is kept",
    );
  });
});
