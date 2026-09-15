import type { SessionUpdate } from "../protocol";
import { toolDisplayTitle } from "./toolDisplay";

type ToolCall = Extract<SessionUpdate, { kind: "tool_call" }>;

export type ToolCategory = "read" | "search" | "edit" | "run" | "other";
export type ActivityCategory = ToolCategory | "think";

export interface TranscriptEntry {
  mergedIndex: number;
  update: SessionUpdate;
}

export interface ActivityItem {
  /** Stable key from `sessionUpdateKey`: `tool:<id>` / `edit:<id>` / `i:<index>`. */
  key: string;
  category: ActivityCategory;
  entry: TranscriptEntry;
}

export interface ActivityTally {
  /** Tool categories in the order the agent first used them. */
  order: ToolCategory[];
  reads: Set<string>;
  searches: number;
  edits: Set<string>;
  /** `null` while no edit in the group reported a line count. */
  additions: number | null;
  deletions: number | null;
  runs: number;
  others: number;
  failed: number;
  thoughts: number;
}

export type ActivityClip =
  | { kind: "read"; count: number; text: string }
  | { kind: "search"; count: number; text: string }
  | {
      kind: "edit";
      files: number;
      /** Absent when the agent reported no line counts at all. */
      additions?: number;
      deletions?: number;
      /** Set only when the group edited a single file, so the diffstat can open it. */
      path?: string;
      text: string;
    }
  | { kind: "run"; count: number; text: string }
  | { kind: "other"; count: number; text: string };

export interface ActivitySummary {
  /** One clause per category present, already phrased for the current state. */
  text: string;
  clips: ActivityClip[];
  failed: number;
}

const TOOL_VERB =
  /^(Read|List|View|Open|Search|Find|Grep|Glob|Edit|Write|Create|Add|Delete|Remove|Move|Rename|Run|Execute|Bash|Command|Fetch|Use)\b[\s:·-]*/i;

/** A tool call's category, from `tool_kind` with the display title as fallback. */
export function classifyToolCall(update: ToolCall): ToolCategory {
  switch (update.tool_kind) {
    case "read":
      return "read";
    case "search":
      return "search";
    case "edit":
    case "delete":
    case "move":
      return "edit";
    case "execute":
      return "run";
    default:
      return classifyToolTitle(toolDisplayTitle(update));
  }
}

function classifyToolTitle(title: string): ToolCategory {
  if (/^(Read|List|View|Open)\b/i.test(title)) return "read";
  if (/^(Search|Find|Grep|Glob)\b/i.test(title)) return "search";
  if (/^(Edit|Write|Create|Add|Delete|Remove|Move|Rename)\b/i.test(title)) return "edit";
  if (/^(Run|Execute|Bash|Command|Shell)\b/i.test(title)) return "run";
  return "other";
}

export function isActivityUpdate(update: SessionUpdate): boolean {
  return (
    update.kind === "agent_thought" || update.kind === "file_edit" || update.kind === "tool_call"
  );
}

export function categoryForUpdate(update: SessionUpdate): ActivityCategory {
  if (update.kind === "agent_thought") return "think";
  if (update.kind === "file_edit") return "edit";
  return classifyToolCall(update as ToolCall);
}

export function basenameOf(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? trimmed;
}

/** The path or query a tool call names, stripped of its verb. `null` when unknown. */
export function toolTarget(update: ToolCall): string | null {
  const title = toolDisplayTitle(update);
  const quoted = title.match(/['"`]([^'"`]+)['"`]/);
  if (quoted) return quoted[1];
  const stripped = title
    .replace(TOOL_VERB, "")
    .replace(/^file\b[\s:·-]*/i, "")
    .trim();
  return stripped || null;
}

export function tallyActivity(items: ActivityItem[]): ActivityTally {
  const tally: ActivityTally = {
    order: [],
    reads: new Set(),
    searches: 0,
    edits: new Set(),
    additions: null,
    deletions: null,
    runs: 0,
    others: 0,
    failed: 0,
    thoughts: 0,
  };

  // ACP can emit both the tool call and the file_edit for one change; the
  // file_edit carries the line counts, so it is the one that gets counted.
  const editIds = new Set<string>();
  for (const item of items) {
    const update = item.entry.update;
    if (update.kind === "file_edit" && update.tool_call_id) editIds.add(update.tool_call_id);
  }

  const note = (category: ToolCategory) => {
    if (!tally.order.includes(category)) tally.order.push(category);
  };

  for (const item of items) {
    const update = item.entry.update;
    if (update.kind === "agent_thought") {
      tally.thoughts += 1;
      continue;
    }
    if (update.kind === "file_edit") {
      note("edit");
      tally.edits.add(update.path || item.key);
      if (update.additions !== undefined)
        tally.additions = (tally.additions ?? 0) + update.additions;
      if (update.deletions !== undefined)
        tally.deletions = (tally.deletions ?? 0) + update.deletions;
      continue;
    }
    if (update.kind !== "tool_call") continue;
    const category = item.category as ToolCategory;
    if (category === "edit" && update.tool_call_id && editIds.has(update.tool_call_id)) continue;
    if (update.status === "failed") tally.failed += 1;
    note(category);
    switch (category) {
      case "read": {
        const target = toolTarget(update) ?? `#${update.tool_call_id}`;
        tally.reads.add(target);
        break;
      }
      case "search":
        tally.searches += 1;
        break;
      case "edit":
        tally.edits.add(toolTarget(update) ?? `#${update.tool_call_id}`);
        break;
      case "run":
        tally.runs += 1;
        break;
      default:
        tally.others += 1;
    }
  }
  return tally;
}

/** The category of the call still in flight: the newest one with work left. */
function runningCategory(items: ActivityItem[]): ToolCategory | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const update = items[index].entry.update;
    if (
      update.kind === "tool_call" &&
      (update.status === "pending" || update.status === "in_progress")
    ) {
      return items[index].category as ToolCategory;
    }
  }
  return undefined;
}

function fileLabel(paths: Set<string>): string {
  const [first] = paths;
  if (paths.size === 1 && first) return basenameOf(first) || first;
  return `${paths.size} files`;
}

function verb(settled: string, progressive: string, live: boolean, isRunning: boolean): string {
  return live && isRunning ? progressive : settled;
}

export function summarizeActivity(items: ActivityItem[], live = false): ActivitySummary {
  const tally = tallyActivity(items);
  const running = live ? runningCategory(items) : undefined;
  const clips: ActivityClip[] = [];

  for (const category of tally.order) {
    const isRunning = category === running;
    switch (category) {
      case "read":
        clips.push({
          kind: "read",
          count: tally.reads.size,
          text: `${verb("Read", "Reading", live, isRunning)} ${fileLabel(tally.reads)}`,
        });
        break;
      case "search":
        clips.push({
          kind: "search",
          count: tally.searches,
          text: verb("Searched the project", "Searching the project", live, isRunning),
        });
        break;
      case "edit": {
        const files = [...tally.edits];
        clips.push({
          kind: "edit",
          files: files.length,
          additions: tally.additions ?? undefined,
          deletions: tally.deletions ?? undefined,
          path: files.length === 1 ? files[0] : undefined,
          text: `${verb("Edited", "Editing", live, isRunning)} ${fileLabel(tally.edits)}`,
        });
        break;
      }
      case "run":
        clips.push({
          kind: "run",
          count: tally.runs,
          text:
            tally.runs === 1
              ? verb("Ran a command", "Running a command", live, isRunning)
              : `${verb("Ran", "Running", live, isRunning)} ${tally.runs} commands`,
        });
        break;
      default:
        clips.push({
          kind: "other",
          count: tally.others,
          text:
            tally.others === 1
              ? verb("Ran a tool", "Running a tool", live, isRunning)
              : `${verb("Ran", "Running", live, isRunning)} ${tally.others} tools`,
        });
    }
  }

  let text = clips.map((clip) => clip.text).join(" · ");
  if (!text) {
    text = tally.thoughts > 0 ? (live ? "Thinking" : "Thought") : live ? "Working" : "Worked";
  }
  if (tally.failed > 0) text += ` · ${tally.failed} failed`;

  return { clips, failed: tally.failed, text };
}

/** The category a group's header icon should show: its last tool, else a thought. */
export function dominantCategory(items: ActivityItem[]): ActivityCategory {
  const running = runningCategory(items);
  if (running) return running;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const category = items[index].category;
    if (category !== "think") return category;
  }
  return "think";
}
