import { describe, expect, it } from "vitest";

import { heldMessage, holdersByBranch, planCheckout } from "./branchCheckout";

const holders = holdersByBranch([
  {
    branch: "warpforge/task/t_1",
    path: "/repo/.warpforge/worktrees/t_1",
    managed: true,
    taskId: "t_1",
  },
  { branch: "warpforge/task/t_2", path: "/repo/.warpforge/worktrees/t_2", managed: true },
  { branch: "main", path: "/repo", primary: true },
  { branch: "feature", path: "/elsewhere/wt" },
]);

describe("planCheckout", () => {
  it("checks out a branch no other worktree holds", () => {
    expect(planCheckout("release", holders)).toEqual({ kind: "checkout" });
    expect(planCheckout("release", holdersByBranch(undefined))).toEqual({ kind: "checkout" });
  });

  it("opens the task that owns the worktree", () => {
    expect(planCheckout("warpforge/task/t_1", holders)).toEqual({
      kind: "open-task",
      taskId: "t_1",
    });
  });

  it("reports a managed worktree with no task as an orphan", () => {
    expect(planCheckout("warpforge/task/t_2", holders)).toEqual({
      kind: "orphan",
      path: "/repo/.warpforge/worktrees/t_2",
    });
  });

  it("distinguishes the project folder from a foreign worktree", () => {
    expect(planCheckout("main", holders)).toEqual({ kind: "held", path: "/repo", primary: true });
    expect(planCheckout("feature", holders)).toEqual({
      kind: "held",
      path: "/elsewhere/wt",
      primary: false,
    });
  });
});

describe("heldMessage", () => {
  it.each(["warpforge/task/t_2", "main", "feature"])("names the path for %s", (branch) => {
    const plan = planCheckout(branch, holders);
    if (plan.kind !== "orphan" && plan.kind !== "held") throw new Error(plan.kind);
    const message = heldMessage(branch, plan);
    expect(message).toContain(plan.path);
    expect(message).toContain(`'${branch}'`);
    expect(message).not.toMatch(/fatal/i);
  });

  it("points an orphan at the Worktrees tab", () => {
    expect(heldMessage("x", { kind: "orphan", path: "/p" })).toContain("Worktrees tab");
  });
});
