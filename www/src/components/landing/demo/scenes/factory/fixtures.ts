/**
 * A backlog item run through Factory: one parent task carrying the workflow
 * run, and the stage tasks the daemon spawns under it (`workflow-stage`,
 * titled `<stage> · <parent title>`), on the project's review-loop workflow.
 */
import { daemon } from "@app/daemon";
import type {
  FileDoc,
  OrchNodeInfo,
  RunnerEntry,
  RunnerStatus,
  Snapshot,
  TaskDiff,
  TaskInfo,
  TaskPullRequest,
  WorkflowRunInfo,
} from "@app/protocol";

import { unchangedDoc } from "../orchestrate/files";
import { agents, PROJECT, project, services, T0, task } from "../world";

export const FACTORY_TASK_ID = "tsk_invoice_csv";
export const IMPLEMENT_ID = "tsk_invoice_csv_implement";
export const REVIEW_ID = "tsk_invoice_csv_review";
export const FIX_ID = "tsk_invoice_csv_fix";

const TITLE = "Export invoices as CSV";
const WORKTREE = `/Users/dev/code/atlas/.warpforge/worktrees/${FACTORY_TASK_ID}`;
const T0_SECS = Math.floor(T0 / 1000);

/** As the backlog item was queued: no worktree until it starts. */
export const queuedTask = task({
  id: FACTORY_TASK_ID,
  prompt:
    "#128 Export invoices as CSV\n\nFinance wants a CSV download of a tenant's invoices for a date range, from the invoices page.",
  tags: ["runner", "workflow:review-loop"],
  title: TITLE,
  worktree: null,
});

const stageTask = (id: string, stage: string, agent: string): TaskInfo =>
  task({
    agent,
    id,
    parentTaskId: FACTORY_TASK_ID,
    prompt: `${stage} stage of ${TITLE}`,
    status: "running",
    tags: ["workflow-stage"],
    title: `${stage} · ${TITLE}`,
    worktree: WORKTREE,
  });

export const implementTask = stageTask(IMPLEMENT_ID, "implement", "claude");
export const reviewTask = stageTask(REVIEW_ID, "review", "codex");
export const fixTask = stageTask(FIX_ID, "fix", "claude");

const RUN: WorkflowRunInfo = {
  maxRounds: 3,
  round: 0,
  stage: "implement",
  workflowId: "review-loop",
  workflowName: "Review loop",
};

const node = (id: string, kind: OrchNodeInfo["kind"], agent: string, taskId: string) =>
  ({ agent, id, kind, status: "running", taskId }) as OrchNodeInfo;

const NODES: OrchNodeInfo[] = [
  node("implement", "implement", "claude", IMPLEMENT_ID),
  node("reviewer (codex), round 1/3", "review", "codex", REVIEW_ID),
  node("fix (round 1)", "fix", "claude", FIX_ID),
  // Round two follows up in the round-one reviewer's own session.
  node("reviewer (codex), round 2/3", "review", "codex", REVIEW_ID),
];

/**
 * The parent as the daemon reports it after `done` graph nodes have
 * completed and the next one is running.
 * @param run The workflow run's state at this point.
 * @param done How many graph nodes have completed.
 * @param over Any other fields of the parent that changed.
 * @returns The full task, as `task.updated` carries it.
 */
export function parentAt(
  run: Partial<WorkflowRunInfo>,
  done: number,
  over: Partial<TaskInfo> = {},
): TaskInfo {
  const finished = run.stage === "done";
  return {
    ...queuedTask,
    orchestrationGraph: {
      goal: RUN.workflowName,
      id: FACTORY_TASK_ID,
      nodes: NODES.slice(0, finished ? done : done + 1).map((entry, index) =>
        index < done ? { ...entry, status: "complete" } : entry,
      ),
    },
    status: "running",
    // Each stage change touches the task, which is what refetches its diff.
    updatedAt: T0 + 1000 * (1 + done * 10 + (run.round ?? 0)),
    worktree: WORKTREE,
    workflowRun: { ...RUN, ...run },
    ...over,
  };
}

const entryAt = (over: Partial<RunnerEntry>): RunnerEntry => ({
  deliver: true,
  enqueuedAt: T0_SECS,
  itemId: "itm_128",
  number: 128,
  position: 0,
  priority: "high",
  project: PROJECT,
  runLocation: "default",
  state: "queued",
  taskId: FACTORY_TASK_ID,
  title: TITLE,
  updatedAt: T0_SECS,
  workflow: "review-loop",
  ...over,
});

/**
 * The project's Factory status with its one entry in `state`.
 * @param over Fields of the entry that changed.
 * @returns What `runner.status` answers and `runner.updated` carries.
 */
export function runnerAt(over: Partial<RunnerEntry>): RunnerStatus {
  return {
    checkout: null,
    dispatchedToday: over.state === "queued" ? 0 : 1,
    entries: [entryAt(over)],
    hold: null,
    settings: {
      agent: "claude",
      headroomPct: 80,
      maxConcurrent: 2,
      maxOpenPrs: 3,
      maxPerDay: 10,
      minFreeGb: 25,
      model: null,
      project: PROJECT,
      runLocation: "worktree",
      updatedAt: T0_SECS,
      workflow: "review-loop",
    },
  };
}

export const pullRequest: TaskPullRequest = {
  author: "warpforge-bot",
  checks: "pending",
  failedChecks: [],
  headOid: "4f2c9a1e",
  number: 41,
  openComments: [],
  state: "draft",
  title: TITLE,
  url: "https://github.com/atlas-dev/atlas/pull/41",
};

export const snapshot: Snapshot = {
  agents,
  portforwards: [],
  projects: [project],
  services,
  sessionHistory: {},
  tasks: [queuedTask],
  terminals: [],
};

const CSV_TS = `import type { Invoice } from "../billing/types";

const HEADER = ["number", "issued_at", "customer", "currency", "total"];

/** RFC 4180: quote a field that holds a comma, a quote or a newline. */
function field(value: string): string {
  return /[",\\n]/.test(value) ? \`"\${value.replaceAll('"', '""')}"\` : value;
}

export function invoicesToCsv(invoices: Invoice[]): string {
  const rows = invoices.map((invoice) => [
    invoice.number,
    invoice.issuedAt.toISOString(),
    invoice.customerName,
    invoice.currency,
    (invoice.totalCents / 100).toFixed(2),
  ]);
  return [HEADER, ...rows].map((row) => row.map(field).join(",")).join("\\r\\n");
}
`;

const added = (path: string, text: string) => ({
  hunks: [
    {
      lines: text.trimEnd().split("\n").map((line) => `+${line}`),
      newLines: text.trimEnd().split("\n").length,
      newStart: 1,
      oldLines: 0,
      oldStart: 0,
      resolution: null,
    },
  ],
  oldPath: null,
  path,
  status: "added" as const,
});

const TEST_TS = `test("quotes a customer name with a comma", () => {
  const csv = invoicesToCsv([invoice({ customerName: "Acme, Inc." })]);
  expect(csv.split("\\r\\n")[1]).toContain('"Acme, Inc."');
});
`;

export const diff: TaskDiff = {
  branch: "factory/128-export-invoices-csv",
  files: [
    added("api/src/export/csv.ts", CSV_TS),
    {
      hunks: [
        {
          lines: [
            ' import { listInvoices } from "../billing/invoices";',
            '+import { invoicesToCsv } from "../export/csv";',
            " ",
            ' invoices.get("/", async (req, res) => {',
            "+  if (req.query.format === \"csv\") {",
            '+    res.type("text/csv").attachment("invoices.csv");',
            "+    return res.send(invoicesToCsv(await listInvoices(tenantOf(req), range(req))));",
            "+  }",
            "   res.json(await listInvoices(tenantOf(req), range(req)));",
          ],
          newLines: 9,
          newStart: 3,
          oldLines: 4,
          oldStart: 3,
          resolution: null,
        },
      ],
      oldPath: null,
      path: "api/src/routes/invoices.ts",
      status: "modified",
    },
    added("api/test/export-csv.test.ts", TEST_TS),
  ],
  ignored: [],
  ignoredAvailable: true,
  ignoredTruncated: false,
  taskId: FACTORY_TASK_ID,
  untrackedAvailable: true,
  untrackedPaths: ["api/src/export/csv.ts", "api/test/export-csv.test.ts"],
};

export function fileDocFor(path: string): FileDoc {
  return path === "api/src/export/csv.ts"
    ? { newText: CSV_TS, oldText: "", path, status: "added" }
    : unchangedDoc(path);
}

/** The shared worktree's diff: the files any stage has reported editing so far. */
export function diffFor(): TaskDiff {
  const updates = daemon.getState().sessionUpdates;
  const edited = new Set(
    [IMPLEMENT_ID, FIX_ID].flatMap((id) =>
      (updates[id] ?? []).flatMap((update) => (update.kind === "file_edit" ? [update.path] : [])),
    ),
  );
  return { ...diff, files: diff.files.filter((file) => edited.has(file.path)) };
}
