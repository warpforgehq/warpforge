import type { AgentLimitWindow } from "@/protocol";

const DEFAULT_SESSION_MINUTES = 300;

const PERIOD_ABBREVIATIONS: Record<string, string> = {
  Weekly: "wk",
  Monthly: "mo",
  Daily: "day",
};

/**
 * The compact window name printed beside a usage bar: "5h", "wk", "wk Opus".
 *
 * @param window the quota window to name
 * @returns a short label; an unrecognised label is returned unchanged
 */
export function usageWindowShortLabel(window: AgentLimitWindow): string {
  if (window.id === "five_hour" || window.label === "Session") {
    const minutes = window.windowMinutes ?? DEFAULT_SESSION_MINUTES;
    return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`;
  }
  if (window.id === "seven_day" || window.label === "Weekly") return "wk";
  const match = /^(\w+)(?:\s*\((.+)\))?$/.exec(window.label.trim());
  const period = match ? PERIOD_ABBREVIATIONS[match[1]] : undefined;
  if (!match || !period) return window.label;
  return match[2] ? `${period} ${match[2]}` : period;
}
