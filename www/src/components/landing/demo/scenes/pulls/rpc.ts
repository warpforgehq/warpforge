import { checks, diff, type timeline } from "./fixtures";

type World = ReturnType<typeof timeline>;

/**
 * Answer the inbox's `tracker.pulls.*` reads from the scene's world.
 * @param world The pull requests as this pass of the scene made them.
 * @param method The RPC.
 * @param params Its params; reads carry the PR `number`.
 * @returns The reply, or `undefined` for a method this does not serve.
 */
export function servePulls(
  world: World,
  method: string,
  params: unknown,
): Promise<unknown> | undefined {
  const number = Number((params as { number?: unknown } | undefined)?.number);
  const ours = number === world.summary.number;
  const other = world.pulls.find((pr) => pr.number === number) ?? world.summary;
  switch (method) {
    case "tracker.pulls.list":
      return Promise.resolve({ items: world.pulls });
    case "tracker.pulls.details":
      return Promise.resolve(
        ours
          ? world.details
          : { ...world.details, ...other, additions: 0, body: "", changedFiles: 0, deletions: 0 },
      );
    case "tracker.pulls.diff":
      return Promise.resolve(
        ours ? diff : { additions: 0, deletions: 0, files: [], patch: "", truncated: false },
      );
    case "tracker.pulls.commits":
      return Promise.resolve({ items: ours ? world.commits : [] });
    case "tracker.pulls.thread":
      return Promise.resolve(
        ours
          ? world.thread
          : { ...world.thread, comments: [], headRefName: other.headRefName },
      );
    case "tracker.pulls.checks":
      return Promise.resolve({ items: ours ? checks : [] });
    default:
      return undefined;
  }
}
