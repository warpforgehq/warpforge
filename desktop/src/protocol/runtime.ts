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
  /** Absolute path of the checkout the service runs from (the project root). */
  checkout?: string;
  /** True when the service's declared port is a hard pin, not a hint. */
  portPinned?: boolean;
  /** Set while the service is up but nothing answers on its allocated port. */
  portWarning?: PortWarning;
  logSeq: number;
  needsRestart?: boolean;
  /** True when the personal local config file added or changed this service. */
  local?: boolean;
  /** Fields the local config file set on this service. */
  localFields?: string[];
}

export interface PortWarning {
  expected: number;
  /** Other local ports the service printed in its logs that accept a connection. */
  listening?: number[];
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
  /** True when the personal local config file added or changed this forward. */
  local?: boolean;
  /** Fields the local config file set on this forward. */
  localFields?: string[];
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
  /** Task this terminal belongs to; absent for a project-level terminal. */
  taskId?: string | null;
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
