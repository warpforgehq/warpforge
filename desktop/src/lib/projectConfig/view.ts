import type { EffectiveProjectConfig, ProjectConfigService } from "@/protocol";

import type { ConfigOp, ConfigPath } from "./ops";

type Json = Record<string, unknown>;

const isMap = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const asMap = (value: unknown): Json => (isMap(value) ? value : {});
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asText = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function mergeEntry(base: Json, key: string, value: unknown) {
  if (value === null) {
    delete base[key];
    return;
  }
  const existing = base[key];
  if (!isMap(value) || (key in base && !isMap(existing))) {
    base[key] = value;
    return;
  }
  const target = { ...asMap(existing) };
  for (const [child, next] of Object.entries(value)) mergeEntry(target, child, next);
  base[key] = target;
}

/**
 * Identify a port forward the way the daemon does: its name, else `namespace:pod`.
 * @param entry a forward mapping
 * @returns the key, or null when the entry has neither
 */
export function forwardKey(entry: unknown): string | null {
  const map = asMap(entry);
  if (typeof map.name === "string") return map.name;
  if (typeof map.namespace === "string" && typeof map.pod === "string") {
    return `${map.namespace}:${map.pod}`;
  }
  return null;
}

function mergeForwards(base: unknown[], local: unknown[]): unknown[] {
  const merged = base.map((entry) => (isMap(entry) ? { ...entry } : entry));
  for (const entry of local) {
    if (!isMap(entry)) continue;
    const key = forwardKey(entry);
    const index = merged.findIndex((candidate) => forwardKey(candidate) === key);
    const { remove, ...fields } = entry;
    if (remove === true) {
      if (index >= 0) merged.splice(index, 1);
    } else if (index >= 0) {
      const target = { ...asMap(merged[index]) };
      for (const [child, next] of Object.entries(fields)) mergeEntry(target, child, next);
      merged[index] = target;
    } else {
      merged.push(fields);
    }
  }
  return merged;
}

/**
 * Deep-merge the local overlay over the shared config, as the daemon does.
 * @param shared the shared file's data
 * @param local the local file's data
 * @returns the merged data
 */
export function mergeConfig(shared: unknown, local: unknown): Json {
  const merged = { ...asMap(shared) };
  for (const [key, value] of Object.entries(asMap(local))) {
    if (key === "portforwards" && Array.isArray(value)) {
      merged.portforwards = mergeForwards(asList(merged.portforwards), value);
    } else {
      mergeEntry(merged, key, value);
    }
  }
  return merged;
}

/**
 * Key paths the local overlay sets, in the daemon's `localFields` shape.
 * @param local the local file's data
 * @returns leaf paths; forwards are keyed by `forwardKey`
 */
export function localFieldPaths(local: unknown): string[][] {
  const fields: string[][] = [];
  const walk = (path: string[], value: unknown) => {
    if (isMap(value)) for (const [key, next] of Object.entries(value)) walk([...path, key], next);
    else fields.push(path);
  };
  for (const [key, value] of Object.entries(asMap(local))) {
    if (key === "portforwards" && Array.isArray(value)) {
      for (const entry of value) {
        const name = forwardKey(entry);
        if (!name) continue;
        for (const [field, next] of Object.entries(asMap(entry))) {
          if (field !== "name") walk(["portforwards", name, field], next);
        }
      }
    } else {
      walk([key], value);
    }
  }
  return fields;
}

function toService(value: unknown): ProjectConfigService {
  const map = asMap(value);
  const env = isMap(map.env)
    ? Object.fromEntries(Object.entries(map.env).map(([key, next]) => [key, asText(next) ?? ""]))
    : null;
  const health = asMap(map.healthcheck);
  return {
    command: asText(map.command) ?? "",
    dependsOn: asList(map.dependsOn).map(String),
    env,
    healthcheck:
      typeof health.url === "string"
        ? { interval: asText(health.interval), url: health.url }
        : null,
    port: asNumber(map.port),
    portFallback: map.portFallback === "auto" ? "auto" : null,
    readyPattern: asText(map.readyPattern),
    readyTimeout: asText(map.readyTimeout),
  };
}

/**
 * The typed view of merged config data.
 * @param merged output of `mergeConfig`
 * @param name the project name, used when the file has none
 * @param localFields paths set by the local overlay
 * @returns the config in the daemon's effective shape
 */
export function toEffective(
  merged: Json,
  name: string,
  localFields: string[][],
): EffectiveProjectConfig {
  const worktree = isMap(merged.worktree) ? merged.worktree : null;
  const ports = asMap(merged.ports);
  return {
    agentTemplates: Object.fromEntries(
      Object.entries(asMap(merged.agentTemplates)).map(([key, value]) => [
        key,
        {
          command: asText(asMap(value).command) ?? "",
          description: asText(asMap(value).description),
        },
      ]),
    ),
    linked: asList(merged.linked).map(String),
    localFields,
    name: asText(merged.name) ?? name,
    portforwards: asList(merged.portforwards).map((value) => {
      const map = asMap(value);
      return {
        localPort: asNumber(map.localPort) ?? 0,
        name: asText(map.name),
        namespace: asText(map.namespace) ?? "",
        pod: asText(map.pod) ?? "",
        remotePort: asNumber(map.remotePort) ?? 0,
      };
    }),
    ports: ports.range === undefined ? null : { range: String(ports.range) },
    services: Object.fromEntries(
      Object.entries(asMap(merged.services)).map(([key, value]) => [key, toService(value)]),
    ),
    worktree: worktree
      ? { copy: asList(worktree.copy).map(String), setup: asText(worktree.setup) }
      : null,
  };
}

/**
 * Whether the local overlay sets this path or anything below it.
 * @param localFields paths set by the local overlay
 * @param path the field or row
 * @returns true when the value comes from the overlay
 */
export function isLocalPath(localFields: string[][], path: ConfigPath): boolean {
  return localFields.some((field) => path.every((key, index) => field[index] === String(key)));
}

/**
 * The index of a forward in a file's `portforwards` list.
 * @param data the file's data
 * @param key the forward's `forwardKey`
 * @returns its index, or -1
 */
export function forwardIndex(data: unknown, key: string): number {
  return asList(asMap(data).portforwards).findIndex((entry) => forwardKey(entry) === key);
}

/**
 * The length of a file's `portforwards` list.
 * @param data the file's data
 * @returns the number of entries
 */
export function forwardCount(data: unknown): number {
  return asList(asMap(data).portforwards).length;
}

export const SECRET_KEY = /TOKEN|SECRET|KEY|PASSWORD|PASS|PRIVATE/i;

/**
 * Env keys that look secret and that pending ops would write to the shared file.
 * @param ops pending ops
 * @returns the secret-looking keys, deduplicated
 */
export function sharedSecretKeys(ops: readonly ConfigOp[]): string[] {
  const keys = new Set<string>();
  const walk = (path: readonly (string | number)[], value: unknown) => {
    if (path.length === 4 && path[0] === "services" && path[2] === "env") {
      if (SECRET_KEY.test(String(path[3]))) keys.add(String(path[3]));
      return;
    }
    if (path.length < 4 && isMap(value)) {
      for (const [key, next] of Object.entries(value)) walk([...path, key], next);
    }
  };
  for (const op of ops) if (op.scope === "shared" && !op.remove) walk(op.path, op.value);
  return [...keys];
}
