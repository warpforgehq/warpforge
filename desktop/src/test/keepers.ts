import type { KeeperFinding, KeeperRun } from "@/protocol";

/**
 * @param fields the run's id and the fields to replace
 * @returns a green review run on task `t1`
 */
export const run = (fields: Partial<KeeperRun> & { id: string }): KeeperRun => ({
  count: 0,
  headSha: "abcdef0123",
  keeperId: "review",
  outcome: "green",
  round: 0,
  runNumber: 1,
  startedAt: 1,
  taskId: "t1",
  trigger: "commit",
  ...fields,
});

/**
 * @param fields the finding's id and the fields to replace
 * @returns an open medium finding of run `r1`
 */
export const finding = (fields: Partial<KeeperFinding> & { id: string }): KeeperFinding => ({
  description: "Off by one",
  key: fields.id,
  runId: "r1",
  severity: "medium",
  status: "open",
  ...fields,
});
