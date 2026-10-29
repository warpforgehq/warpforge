import type { WorktreeBase } from "../../protocol";

/** The line under the composer for a chat, which has no project. */
export const CHAT_LINE = "Runs in its own folder, outside any project.";

/**
 * Where an isolated task runs, in words.
 * @param base The branch the worktree starts from; null for the checkout's.
 * @returns The line shown under the composer.
 */
export function worktreeLine(base: WorktreeBase | null): string {
  switch (base?.kind) {
    case "origin":
      return "Runs in an isolated worktree on a new branch from origin's latest.";
    case "existing":
      return "Runs in an isolated worktree on this branch; pushes go to it.";
    case "pullRequest":
      return "Runs in an isolated worktree on pull request #" + base.number + "'s branch.";
    default:
      return "Runs in an isolated git worktree.";
  }
}
