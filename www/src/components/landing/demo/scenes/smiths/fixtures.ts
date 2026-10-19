/**
 * Three Smiths on three harnesses, members of one named channel in `atlas`.
 *
 * Each Smith has its thread: the hidden `origin: "smith"` task the daemon
 * creates with it, through which it reads and replies in channels. Work
 * happens in a separate work session, an ordinary task carrying `smithId`.
 */
import type {
  AgentConfig,
  Channel,
  PeerMessage,
  Smith,
  SmithDetail,
  Snapshot,
  TaskInfo,
} from "@app/protocol";

import { agents, PROJECT, project, services, task } from "../world";

export const CHANNEL_ID = "ch_7b2e91d0";
export const CHANNEL_KEY = `${PROJECT}::ch::${CHANNEL_ID}`;
export const WORK_TASK_ID = "t_5e1a9c";

const opencode: AgentConfig = {
  acpCommand: "opencode",
  displayName: "opencode",
  enabled: true,
  id: "opencode",
  models: [],
};

const smith = (id: string, name: string, agent: string, color: number, thread: string): Smith => ({
  agent,
  allowedProjects: [PROJECT],
  budget: {},
  charterRev: "4c1e0a2",
  color,
  createdAt: 1_768_000_000,
  homeProject: PROJECT,
  id,
  name,
  permissions: { createPr: true, push: true, writePaths: [] },
  soulRev: "9a03f7d",
  threadTaskId: thread,
});

export const ada = smith("sm_ada", "Ada", "claude", 0, "t_a0d1");
export const rex = smith("sm_rex", "Rex", "codex", 1, "t_b0e2");
export const oly = smith("sm_oly", "Oly", "opencode", 2, "t_c0f3");
export const SMITHS = [ada, rex, oly];

/** As `smiths.create` makes it: titled with the name, waiting, off the board. */
export const threadOf = (s: Smith, status: TaskInfo["status"] = "waiting"): TaskInfo =>
  task({
    agent: s.agent,
    id: s.threadTaskId,
    origin: "smith",
    prompt: `${s.name}'s thread`,
    smithId: s.id,
    status,
    tags: [`smith:${s.id}`],
    title: s.name,
    worktree: null,
  });

export const channel: Channel = {
  createdAt: 1_768_000_000,
  id: CHANNEL_ID,
  members: SMITHS.map((s) => ({ name: s.name, smithId: s.id })),
  name: "billing",
  project: PROJECT,
  working: [],
};

/** What `start_work` creates: a running board task as Ada, titled later. */
export const workTask = task({
  agent: "claude",
  id: WORK_TASK_ID,
  prompt:
    "Add a CSV export of a tenant's invoices for a date range: `GET /invoices?format=csv`, RFC 4180 quoting, same range validation as the JSON route. Tests for quoting and an inverted range.",
  smithId: ada.id,
  status: "running",
  title: "",
});

export const snapshot: Snapshot = {
  agents: [...agents, opencode],
  portforwards: [],
  projects: [project],
  services,
  sessionHistory: {},
  tasks: SMITHS.map((s) => threadOf(s)),
  terminals: [],
};

/**
 * A channel post as the daemon records it.
 * @param id The record id.
 * @param at Epoch seconds.
 * @param text The post.
 * @param from The Smith posting it; absent for the user.
 * @param mentions The thread ids the post reached.
 * @returns The record `peer.messageUpdated` carries.
 */
export function post(
  id: number,
  at: number,
  text: string,
  from?: Smith,
  mentions?: Smith[],
): PeerMessage {
  return {
    channelId: CHANNEL_ID,
    createdAt: at,
    id,
    project: PROJECT,
    status: "posted",
    text,
    ...(from && { fromLabel: from.name, fromSmithId: from.id, fromTask: from.threadTaskId }),
    ...(mentions && { mentions: mentions.map((s) => s.threadTaskId) }),
  };
}

const SOULS: Record<string, string> = {
  [ada.id]: "# Ada\n\nPlain, short sentences. Says what she checked before what she thinks.",
  [oly.id]: "# Oly\n\nQuiet unless there is something new. Prefers a question to a guess.",
  [rex.id]: "# Rex\n\nDirect. Flags risk first, then the fix.",
};

/**
 * @param id A Smith id.
 * @returns What `smiths.get` answers for its page.
 */
export function detailOf(id: string): SmithDetail | undefined {
  const found = SMITHS.find((s) => s.id === id);
  return found && { charter: "habits: []\n", smith: found, soul: SOULS[found.id] ?? "" };
}
