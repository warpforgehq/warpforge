import type { ProjectInfo } from "./events";

/** How a project's port range was resolved (mirrors Rust `PortRangeSource`). */
export type PortRangeSource = "auto" | "sticky" | "declared" | "localOverride";

export interface ProjectConfigState {
  project: ProjectInfo;
  services: ServiceInfo[];
  portforwards: PortForwardInfo[];
}

export type ServiceStatus = "starting" | "running" | "stopped" | "failed";

export interface ServiceInfo {
  project: string;
  name: string;
  command: string;
  status: ServiceStatus;
  originalPort: number;
  allocatedPort: number;
  /** True when the service's declared port is a hard pin, not a hint. */
  portPinned?: boolean;
  logSeq: number;
}

export type PortForwardStatus = "starting" | "active" | "restarting" | "failed" | "stopped";

export interface PortForwardInfo {
  project: string;
  name: string;
  namespace: string;
  pod: string;
  localPort: number;
  remotePort: number;
  status: PortForwardStatus;
  logSeq: number;
}

export interface ConfigChoice {
  value: string;
  name: string;
}

export interface ConfigOption {
  id: string;
  name: string;
  /** "mode" | "model" | "model_config" | "thought_level" | … */
  category?: string | null;
  currentValue: string;
  options: ConfigChoice[];
}

// ── Terminals ───────────────────────────────────────────────────────────────

export interface TerminalInfo {
  id: string;
  project: string;
  command: string;
  startedAt: number;
  cols: number;
  rows: number;
}

export interface TerminalScreen {
  cols: number;
  rows: number;
  cursor: [number, number];
  rowsContent: StyledSpan[][];
}

export interface StyledSpan {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  inverse?: boolean;
}
