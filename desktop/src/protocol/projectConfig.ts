export type ProjectConfigScope = "shared" | "local";

export interface ProjectConfigFile {
  /** Display path. The daemon selects the write target. */
  path: string;
  exists: boolean;
  text: string;
  fingerprint: string | null;
}

export interface ProjectConfigError {
  file: string;
  line?: number;
  column?: number;
  message: string;
}

export type ProjectConfigRpcError =
  | { code: "config_changed"; fingerprint: string | null; message: string }
  | { code: "config_invalid"; line?: number; column?: number; message: string };

export interface ProjectConfigService {
  command: string;
  port: number | null;
  env: Record<string, string> | null;
  healthcheck: { url: string; interval: string | null } | null;
  readyPattern: string | null;
  readyTimeout: string | null;
  dependsOn: string[];
  portFallback: "auto" | null;
}

export interface ProjectConfigForward {
  name: string | null;
  namespace: string;
  pod: string;
  localPort: number;
  remotePort: number;
}

export interface EffectiveProjectConfig {
  name: string;
  services: Record<string, ProjectConfigService>;
  worktree: { copy: string[]; setup: string | null } | null;
  ports: { range: string } | null;
  agentTemplates: Record<string, { command: string; description: string | null }>;
  portforwards: ProjectConfigForward[];
  linked: string[];
  /** Key paths supplied by local YAML. Forwards use name or namespace:pod as the key. */
  localFields: string[][];
}

export interface ReadProjectConfigResult {
  shared: ProjectConfigFile;
  local: ProjectConfigFile;
  configError: ProjectConfigError | null;
  localConfigError: string | null;
  effective: EffectiveProjectConfig;
}

export interface WriteProjectConfigParams {
  project: string;
  scope: ProjectConfigScope;
  text: string;
  base: string | null;
}

export interface WriteProjectConfigResult {
  fingerprint: string;
}
