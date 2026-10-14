import type { BranchWorktree } from "../../protocol";

/** What "Checkout" does for a local branch. */
export type CheckoutPlan =
  | { kind: "checkout" }
  | { kind: "open-task"; taskId: string }
  | { kind: "orphan"; path: string }
  | { kind: "held"; path: string; primary: boolean };

/** A plan that cannot proceed and is explained to the user instead. */
export type BlockedPlan = Extract<CheckoutPlan, { kind: "orphan" | "held" }>;

/**
 * Index the worktree holders reported by `git.branches`.
 *
 * @param list Holders from `GitBranchList.worktrees`.
 * @returns Branch name → the worktree holding it.
 */
export function holdersByBranch(list?: BranchWorktree[]): Map<string, BranchWorktree> {
  return new Map((list ?? []).map((h) => [h.branch, h]));
}

/**
 * Decide how to check out a branch that may be held by another worktree.
 *
 * @param branch Local branch name.
 * @param holders Branch → worktree holding it.
 * @returns The action to take.
 */
export function planCheckout(branch: string, holders: Map<string, BranchWorktree>): CheckoutPlan {
  const holder = holders.get(branch);
  if (!holder) return { kind: "checkout" };
  if (holder.taskId) return { kind: "open-task", taskId: holder.taskId };
  if (holder.managed) return { kind: "orphan", path: holder.path };
  return { kind: "held", path: holder.path, primary: Boolean(holder.primary) };
}

/**
 * Explain why a held branch cannot be checked out here.
 *
 * @param branch Local branch name.
 * @param plan The blocked plan for it.
 * @returns One sentence naming the worktree path.
 */
export function heldMessage(branch: string, plan: BlockedPlan): string {
  if (plan.kind === "orphan") {
    return `'${branch}' is checked out in a worktree whose task no longer exists (${plan.path}). Remove it from the project's Worktrees tab to check the branch out here.`;
  }
  if (plan.primary) {
    return `'${branch}' is checked out in the project folder at ${plan.path}. Switch that checkout to another branch first.`;
  }
  return `'${branch}' is checked out in another worktree at ${plan.path}. Switch that worktree to another branch first.`;
}
