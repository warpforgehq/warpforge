import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

import { EmptyState } from "./empty-state";

describe("EmptyState", () => {
  it("renders the icon, title and hint", () => {
    render(<EmptyState icon={Inbox} title="Nothing here" hint="Add the first one." />);

    expect(screen.getByText("Nothing here")).toBeTruthy();
    expect(screen.getByText("Add the first one.")).toBeTruthy();
    expect(document.querySelector("svg")).toBeTruthy();
  });

  it("renders an action when the emptiness can be fixed", () => {
    render(
      <EmptyState
        title="No work items"
        action={
          <Button type="button" onClick={() => {}}>
            Add work item
          </Button>
        }
      />,
    );

    expect(screen.getByRole("button", { name: "Add work item" })).toBeTruthy();
  });

  it("omits the action for a passive state", () => {
    render(<EmptyState title="No failures" />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
