import type { AgentConfig, KeeperDefinition } from "@/protocol";

import { configRole } from "./configRole";

/** The harness, model and effort a keeper runs on; unset keys fall back to the task's agent. */
export interface KeeperRunsOn {
  agent?: string;
  model?: string;
  effort?: string;
}

const KEYS = ["agent", "model", "effort"] as const;

function scalar(value: string): string {
  return /^[\w./@+-][\w./@+:-]*$/.test(value) && !value.endsWith(":")
    ? value
    : JSON.stringify(value);
}

function keyLine(lines: readonly string[], key: string): number {
  return lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line));
}

/**
 * Set a keeper file's `agent`, `model` and `effort` top-level keys, removing
 * the unset ones and leaving every other line as it was.
 * @param text The keeper file's YAML.
 * @param runsOn The values to write; an empty or absent one removes its key.
 * @returns The edited YAML.
 */
export function setKeeperRunsOn(text: string, runsOn: KeeperRunsOn): string {
  const ending = text.endsWith("\n") || text === "" ? "\n" : "";
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  KEYS.forEach((key, order) => {
    const value = runsOn[key]?.trim();
    const at = keyLine(lines, key);
    if (!value) {
      if (at >= 0) lines.splice(at, 1);
      return;
    }
    if (at >= 0) {
      const comment = /\s+#.*$/.exec(lines[at].slice(lines[at].indexOf(":") + 1))?.[0] ?? "";
      lines[at] = `${key}: ${scalar(value)}${comment}`;
      return;
    }
    const anchors = [...KEYS.slice(0, order).reverse(), "preset", "version"];
    const anchor = anchors.map((name) => keyLine(lines, name)).find((index) => index >= 0);
    lines.splice(anchor === undefined ? lines.length : anchor + 1, 0, `${key}: ${scalar(value)}`);
  });
  return lines.join("\n") + ending;
}

/**
 * @param agents The configured agents.
 * @param agentId The harness id.
 * @returns That harness's model and effort selectors, when it has been probed.
 */
export function runsOnOptions(agents: readonly AgentConfig[], agentId: string | undefined) {
  const options = agents.find((agent) => agent.id === agentId)?.models ?? [];
  return {
    effort: options.find((option) => configRole(option) === "effort"),
    model: options.find((option) => configRole(option) === "model"),
  };
}

/**
 * @param definition The keeper's parsed definition.
 * @param agents The configured agents.
 * @returns What the keeper runs on, e.g. `opencode · deepseek-v4.1-flash`, or
 *   `Task's agent` when its file names no harness.
 */
export function runsOnLabel(
  definition: Pick<KeeperDefinition, "agent" | "model">,
  agents: readonly AgentConfig[],
): string {
  const model = definition.model
    ? (runsOnOptions(agents, definition.agent).model?.options.find(
        (choice) => choice.value === definition.model,
      )?.name ?? definition.model.split("/").pop())
    : undefined;
  return [definition.agent || "Task's agent", model].filter(Boolean).join(" · ");
}
