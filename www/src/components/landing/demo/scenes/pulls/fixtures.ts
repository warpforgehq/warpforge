/**
 * Pull request #12, opened by a task in `atlas`, and the inbox it sits in.
 *
 * The files span every risk group the review groups by, so the grouping is
 * the app's own path heuristics at work, not something laid out by hand.
 */
import type {
  PullCheckRun,
  PullComment,
  PullCommit,
  PullRequestDetails,
  PullRequestSummary,
  PullThread,
  SessionUpdate,
  Snapshot,
  TaskPullRequest,
} from "@app/protocol";

import { agents, PROJECT, project, services, task } from "../world";
import { type PatchFile, pullDiff, taskDiff } from "./patch";

export const PR_TASK_ID = "tsk_seat_billing";
export const REPO = "atlas-dev/atlas";
const NUMBER = 12;
const TITLE = "Bill tenants per seat";
const BRANCH = "feat/seat-billing";
const HEAD = "9c1d2e7b4a";
const URL = `https://github.com/${REPO}/pull/${NUMBER}`;
const AUTHOR = { login: "dev" };
const REVIEWER = { login: "mara" };

export const prTask = task({
  filesChanged: 7,
  id: PR_TASK_ID,
  prompt: "Bill tenants per seat instead of a flat plan, and open a PR.",
  status: "waiting",
  title: TITLE,
});

export const snapshot: Snapshot = {
  agents,
  portforwards: [],
  projects: [project],
  services,
  sessionHistory: {},
  tasks: [prTask],
  terminals: [],
};

export const sessionUpdates: Record<string, SessionUpdate[]> = {
  [PR_TASK_ID]: [
    { kind: "user_message", text: "Bill tenants per seat instead of a flat plan, and open a PR." },
    {
      kind: "agent_text",
      text: "Seats are counted from active memberships and billed monthly. A migration backfills `seats` for existing subscriptions. Opened **PR #12** as ready for review.",
    },
    { kind: "turn_ended", stop_reason: "end_turn" },
  ],
};

const FILES: PatchFile[] = [
  {
    lines: [
      "+ALTER TABLE subscriptions ADD COLUMN seats integer NOT NULL DEFAULT 1;",
      "+",
      "+UPDATE subscriptions s",
      "+   SET seats = (SELECT count(*) FROM memberships m",
      "+                 WHERE m.tenant_id = s.tenant_id AND m.active);",
    ],
    oldStart: 0,
    path: "db/migrations/0042_seat_billing.sql",
  },
  {
    lines: [
      "+export function seatsFor(tenant: Tenant): number {",
      "+  return tenant.memberships.filter((m) => m.active).length;",
      "+}",
      "+",
      "+export function monthlyCents(plan: Plan, seats: number): number {",
      "+  return plan.seatCents * Math.max(seats, plan.minSeats);",
      "+}",
    ],
    oldStart: 0,
    path: "api/src/billing/seats.ts",
  },
  {
    lines: [
      ' import { invoiceFor } from "./invoice";',
      '+import { monthlyCents, seatsFor } from "./seats";',
      " ",
      " export function nextInvoice(tenant: Tenant) {",
      "-  return invoiceFor(tenant, tenant.plan.flatCents);",
      "+  return invoiceFor(tenant, monthlyCents(tenant.plan, seatsFor(tenant)));",
      " }",
    ],
    oldStart: 4,
    path: "api/src/billing/cycle.ts",
  },
  {
    lines: [
      '+test("bills the plan minimum below it", () => {',
      "+  expect(monthlyCents(plan({ seatCents: 900, minSeats: 3 }), 1)).toBe(2700);",
      "+});",
    ],
    oldStart: 0,
    path: "api/test/seats.test.ts",
  },
  {
    lines: [
      "       - run: bun test",
      "+      - run: bun run db:migrate --dry-run",
    ],
    oldStart: 21,
    path: ".github/workflows/ci.yml",
  },
  {
    lines: [' "dependencies": {', '-    "pg": "8.12.0",', '+    "pg": "8.13.1",'],
    oldStart: 88,
    path: "bun.lock",
  },
  {
    lines: [
      " ## Pricing",
      " ",
      "-Every plan is a flat monthly price.",
      "+Plans are billed per active seat, with a minimum per plan.",
    ],
    oldStart: 3,
    path: "docs/billing/pricing.md",
  },
];

export const diff = pullDiff(FILES);
export const worktreeDiff = taskDiff(FILES, PR_TASK_ID, BRANCH);

export const failingCheck: PullCheckRun = {
  name: "ci / test",
  state: "failing",
  url: `https://github.com/${REPO}/actions/runs/8812/job/1`,
};

export const checks: PullCheckRun[] = [
  failingCheck,
  { name: "ci / lint", state: "passing", url: `https://github.com/${REPO}/actions/runs/8812/job/2` },
  { name: "ci / typecheck", state: "passing", url: `https://github.com/${REPO}/actions/runs/8812/job/3` },
  { name: "deploy-preview", state: "passing", url: `https://github.com/${REPO}/deployments/412` },
];

/**
 * The PR's dates are relative to when the scene starts, so the inbox reads
 * "1h" rather than however long ago this site was built.
 * @param now Epoch seconds at scene start.
 * @returns Everything time-stamped the scene serves.
 */
export function timeline(now: number) {
  const iso = (secs: number) => new Date(secs * 1000).toISOString();
  const opened = now - 3 * 3600;
  const reviewed = now - 600;

  const reviewComment: PullComment = {
    author: REVIEWER,
    body: "This backfill updates every subscription in one statement and holds the lock for all of it. Can we batch it by tenant?",
    createdAt: iso(reviewed),
    diffHunk:
      "@@ -0,0 +1,5 @@\n+ALTER TABLE subscriptions ADD COLUMN seats integer NOT NULL DEFAULT 1;\n+\n+UPDATE subscriptions s",
    id: "rc_301",
    kind: "review_comment",
    line: 3,
    path: "db/migrations/0042_seat_billing.sql",
    replies: [],
    resolved: false,
    threadId: "th_301",
    url: `${URL}#discussion_r301`,
  };

  const thread: PullThread = {
    baseRefName: "main",
    comments: [
      {
        author: REVIEWER,
        body: "Looks right overall — one concern on the migration.",
        createdAt: iso(reviewed),
        id: "rv_300",
        kind: "review",
        replies: [],
        state: "COMMENTED",
        url: `${URL}#pullrequestreview-300`,
      },
      reviewComment,
    ],
    headRefName: BRANCH,
    reviewDecision: null,
    truncated: false,
  };

  const summary: PullRequestSummary = {
    additions: diff.additions,
    assignees: [],
    author: AUTHOR,
    baseRefName: "main",
    changedFiles: diff.files.length,
    createdAt: opened,
    deletions: diff.deletions,
    draft: false,
    headRefName: BRANCH,
    labels: [{ color: "0e8a16", name: "billing" }],
    number: NUMBER,
    project: PROJECT,
    repo: REPO,
    reviewDecision: null,
    state: "open",
    title: TITLE,
    updatedAt: reviewed,
    url: URL,
  };

  const others: PullRequestSummary[] = [
    {
      ...summary,
      additions: 29,
      author: { login: "warpforge-bot" },
      changedFiles: 3,
      createdAt: now - 7200,
      deletions: 0,
      draft: true,
      headRefName: "factory/128-export-invoices-csv",
      labels: [],
      number: 41,
      title: "Export invoices as CSV",
      updatedAt: now - 5400,
      url: `https://github.com/${REPO}/pull/41`,
    },
    {
      ...summary,
      additions: 64,
      author: { login: "sam" },
      changedFiles: 9,
      createdAt: now - 3 * 86400,
      deletions: 51,
      headRefName: "chore/express-5",
      labels: [{ color: "c5def5", name: "dependencies" }],
      number: 39,
      title: "Upgrade to Express 5",
      updatedAt: now - 86400,
      url: `https://github.com/${REPO}/pull/39`,
    },
  ];

  const details: PullRequestDetails = {
    additions: diff.additions,
    author: AUTHOR,
    baseRefName: "main",
    body: "Bills each tenant per active seat instead of a flat plan price.\n\n- `seats` column on subscriptions, backfilled from active memberships\n- `monthlyCents` applies the plan's seat minimum\n- CI dry-runs migrations",
    changedFiles: diff.files.length,
    deletions: diff.deletions,
    draft: false,
    headRefName: BRANCH,
    reviewDecision: null,
    reviewRequests: [],
    state: "open",
    title: TITLE,
    url: URL,
  };

  const commits: PullCommit[] = [
    {
      abbreviatedOid: HEAD.slice(0, 7),
      author: AUTHOR,
      committedDate: iso(opened),
      messageHeadline: "feat(billing): bill tenants per seat",
      oid: `${HEAD}${"0".repeat(30)}`,
      parentOid: `5e0a${"0".repeat(36)}`,
    },
  ];

  return { commits, details, pulls: [summary, ...others], reviewComment, summary, thread };
}

/**
 * The task's pull request as `task.pullRequest` reports it.
 * @param over What changed since it was opened.
 * @returns The record the PR chip and the feedback notice read.
 */
export function taskPull(over: Partial<TaskPullRequest> = {}): TaskPullRequest {
  return {
    author: AUTHOR.login,
    checks: "pending",
    failedChecks: [],
    headOid: HEAD,
    number: NUMBER,
    openComments: [],
    state: "open",
    title: TITLE,
    url: URL,
    ...over,
  };
}
