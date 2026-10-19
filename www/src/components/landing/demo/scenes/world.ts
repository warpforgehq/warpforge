/**
 * The project every scene runs in, as the daemon's own wire types.
 */
import type { AgentConfig, ProjectInfo, ServiceInfo, TaskInfo } from "@app/protocol";

export const PROJECT = "atlas";

/** Fixed so the markup a visitor gets is the markup the build produced. */
export const T0 = Date.UTC(2026, 0, 14, 9, 12, 0);

export const project: ProjectInfo = {
  agentTemplates: {},
  declaredServices: ["api", "web"],
  name: PROJECT,
  path: "/Users/dev/code/atlas",
  portRange: [4200, 4299],
};

export const agents: AgentConfig[] = [
  { acpCommand: "claude", displayName: "Claude", enabled: true, id: "claude", models: [] },
  { acpCommand: "codex", displayName: "Codex", enabled: true, id: "codex", models: [] },
];

export const services: ServiceInfo[] = [
  {
    allocatedPort: 4200,
    command: "bun run dev",
    logSeq: 42,
    name: "api",
    originalPort: 3000,
    project: PROJECT,
    status: "running",
  },
  {
    allocatedPort: 4201,
    command: "bun run web",
    logSeq: 17,
    name: "web",
    originalPort: 5173,
    project: PROJECT,
    status: "running",
  },
];

export function task(over: Partial<TaskInfo> & Pick<TaskInfo, "id" | "prompt" | "title">): TaskInfo {
  return {
    agent: "claude",
    blockedReason: null,
    createdAt: T0,
    filesChanged: 0,
    project: PROJECT,
    status: "queued",
    tags: [],
    updatedAt: T0,
    worktree: `/Users/dev/code/atlas/.warpforge/worktrees/${over.id}`,
    ...over,
  };
}
