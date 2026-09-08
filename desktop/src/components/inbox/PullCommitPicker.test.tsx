import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PullCommit } from "@/protocol";

import { PullCommitPicker } from "./PullCommitPicker";

const commits: PullCommit[] = [
  {
    oid: "d6a9f40",
    abbreviatedOid: "d6a9f40",
    parentOid: "base000",
    messageHeadline: "docs: add pipeline map",
    committedDate: "2026-06-01T15:29:00Z",
  },
  {
    oid: "a2ea713",
    abbreviatedOid: "a2ea713",
    parentOid: "d6a9f40",
    messageHeadline: "feat: add gold validation",
    committedDate: "2026-06-01T15:30:00Z",
  },
  {
    oid: "f6df470",
    abbreviatedOid: "f6df470",
    parentOid: "a2ea713",
    messageHeadline: "feat: full TIER-A run",
    committedDate: "2026-06-01T15:31:00Z",
  },
];

describe("PullCommitPicker", () => {
  it("lists the commits newest first and narrows the diff to one", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn<(range: { fromOid: string; toOid: string } | null) => void>();
    render(<PullCommitPicker commits={commits} range={null} onRangeChange={onRangeChange} />);

    await user.click(screen.getByRole("button", { name: /Commits/ }));
    // The newest commit reads first, the way `git log` prints it.
    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((row) => row.textContent).join("|")).toMatch(/f6df470.*a2ea713.*d6a9f40/s);

    await user.click(screen.getByTitle(/feat: full TIER-A run/));
    // Its own parent is the base: one commit's worth of diff.
    expect(onRangeChange).toHaveBeenCalledWith({ fromOid: "a2ea713", toOid: "f6df470" });
  });

  it("says how much of the change it is showing", () => {
    const { rerender } = render(
      <PullCommitPicker commits={commits} range={null} onRangeChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Commits 3" })).toBeInTheDocument();

    rerender(
      <PullCommitPicker
        commits={commits}
        range={{ fromOid: "d6a9f40", toOid: "f6df470" }}
        onRangeChange={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Commits 2/3" })).toBeInTheDocument();
  });

  it("stays out of the way when the commits could not be read", () => {
    render(<PullCommitPicker commits={[]} range={null} onRangeChange={() => {}} />);
    expect(screen.getByRole("button", { name: /Commits/ })).toBeDisabled();
  });
});
