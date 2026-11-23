export interface ConsoleMessage {
  level: string;
  text: string;
}

export interface AgentCall {
  action?: string;
  allowed?: string[];
  ref?: string;
  text?: unknown;
  submit?: unknown;
  interactive?: unknown;
  scope?: unknown;
  headings?: unknown;
  key?: unknown;
  to?: unknown;
  pages?: unknown;
  gone?: unknown;
  ref_gone?: unknown;
  timeout_ms?: unknown;
}

export type AgentResult = Record<string, unknown>;

declare global {
  interface Window {
    __wfAgent?: (call: AgentCall) => string;
    __wfConsole?: () => ConsoleMessage[];
  }
}
