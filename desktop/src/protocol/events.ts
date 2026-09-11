import type { AccountInfo, AgentAccountLimits, AgentConfig, DetectedAgent } from "./agents";
import type { Automation, AutomationRun } from "./automations";
import type {
  PortForwardInfo,
  PortForwardStatus,
  PortRangeSource,
  ProjectConfigState,
  ServiceInfo,
  ServiceStatus,
  TerminalInfo,
  TerminalScreen,
} from "./runtime";
import type { SessionUpdate, TaskInfo } from "./tasks";

// ── Events ──────────────────────────────────────────────────────────────────

export type DaemonEvent =
  | { event: "state.snapshot"; data: Snapshot }
  | { event: "project.added"; data: ProjectInfo }
  | { event: "project.removed"; data: { name: string } }
  | { event: "project.configChanged"; data: ProjectConfigState }
  | {
      event: "service.status";
      data: {
        project: string;
        service: string;
        status: ServiceStatus;
        allocated_port: number;
      };
    }
  | {
      event: "service.log";
      data: { project: string; service: string; seq: number; line: string };
    }
  | {
      event: "portforward.status";
      data: { project: string; name: string; status: PortForwardStatus };
    }
  | {
      event: "portforward.log";
      data: { project: string; name: string; seq: number; line: string };
    }
  | { event: "task.created"; data: TaskInfo }
  | { event: "task.updated"; data: TaskInfo }
  | { event: "task.removed"; data: { id: string } }
  | { event: "session.update"; data: { task_id: string; update: SessionUpdate } }
  | { event: "history.pruned"; data: { updates: number } }
  | {
      event: "history.swept";
      data: { settled: number; expired: number; kept: number };
    }
  | { event: "agents.setup_needed"; data: { detected: DetectedAgent[] } }
  | { event: "agents.updated"; data: { agents: AgentConfig[] } }
  | { event: "accounts.updated"; data: { accounts: AccountInfo[] } }
  | { event: "agentLimits.updated"; data: { accounts: AgentAccountLimits[] } }
  | {
      event: "terminal.screen";
      data: { terminal_id: string; screen: TerminalScreen };
    }
  | { event: "terminal.spawned"; data: TerminalInfo }
  | {
      event: "terminal.data";
      data: { terminal_id: string; data_b64: string };
    }
  | { event: "terminal.exited"; data: { terminal_id: string; code: number } }
  // ── Orchestration ──
  | {
      event: "orchestration.nodeDispatched";
      data: {
        graph_id: string;
        node_id: string;
        task_id: string;
        agent: string;
        kind: string;
      };
    }
  | {
      event: "orchestration.nodeCompleted";
      data: { graph_id: string; node_id: string; task_id: string };
    }
  | {
      event: "orchestration.nodeFailed";
      data: {
        graph_id: string;
        node_id: string;
        task_id: string;
        reason: string;
      };
    }
  | {
      event: "orchestration.allComplete";
      data: { graph_id: string; project: string };
    }
  // ── Automations ──
  | { event: "automation.updated"; data: Automation }
  | { event: "automation.removed"; data: { id: string } }
  | { event: "automation.runUpdated"; data: AutomationRun }
  // ── LSP ──
  | { event: "lsp.message"; data: { server_id: string; payload: unknown } }
  | { event: "lsp.exit"; data: { server_id: string; code: number | null } };

// ── State DTOs ──────────────────────────────────────────────────────────────

export interface Snapshot {
  projects: ProjectInfo[];
  services: ServiceInfo[];
  portforwards: PortForwardInfo[];
  tasks: TaskInfo[];
  terminals: TerminalInfo[];
  /** Always absent: the snapshot carries no transcripts. A transcript is
   *  fetched per task on open via `session.history` (docs/adr/0005). */
  sessionHistory?: Record<string, SessionUpdate[]>;
  /** Configured agents (empty until setup wizard is completed). */
  agents?: AgentConfig[];
  /** Registered agent accounts (empty until the user adds one). */
  accounts?: AccountInfo[];
}

export const EMPTY_SNAPSHOT: Snapshot = {
  portforwards: [],
  projects: [],
  services: [],
  tasks: [],
  terminals: [],
};

export interface ProjectInfo {
  name: string;
  path: string;
  portRange: [number, number];
  /** Where the range came from; absent on snapshots from an older daemon. */
  portRangeSource?: PortRangeSource;
  /** Name of the project whose declared range this one collides with. */
  portRangeConflict?: string | null;
  declaredServices: string[];
  agentTemplates: Record<string, string>;
}
