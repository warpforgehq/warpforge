import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { StreamLine } from "@/views/mission-control/StreamLine";

const update = {
  kind: "keeper_request" as const,
  text: "Fix these findings from Review:\n- src/a.rs:12 off by one",
};

describe("keeper_request in the transcript", () => {
  it("renders as a collapsed Keepers line, not the owner's bubble, and expands to the prompt", async () => {
    const user = userEvent.setup();
    render(<StreamLine update={update} />);
    const line = screen.getByRole("region", { name: "Keepers asked" });
    expect(line).toHaveTextContent("Keepers asked for a fix");
    expect(line).toHaveTextContent("Fix these findings from Review:");
    expect(line).not.toHaveTextContent("off by one");
    expect(line.className).not.toContain("bg-primary/10");

    await user.click(screen.getByRole("button", { expanded: false }));
    expect(line).toHaveTextContent("src/a.rs:12 off by one");
  });

  it("fits one line on a Mission Control tile", () => {
    render(<StreamLine update={update} compact />);
    expect(screen.getByText("Keepers asked:")).toBeInTheDocument();
  });
});
