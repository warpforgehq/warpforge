import type { LogEntry } from "../daemon/types";

export type LogSourceKind = "service" | "portforward";

/** Lines of context an agent is pointed at on each side of the attached range. */
const HINT_CONTEXT_LINES = 20;

const utc = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

function seqRange(first: number, last: number) {
  return first === last ? `seq ${first}` : `seq ${first}–${last}`;
}

function utcRange(first: number, last: number) {
  if (!first || !last) return "";
  const from = utc(first);
  const to = utc(last);
  if (from === to) return `${from} UTC`;
  const sameDay = from.slice(0, 10) === to.slice(0, 10);
  return `${from}–${sameDay ? to.slice(11) : to} UTC`;
}

/**
 * Turn a contiguous run of log lines into a composer context chip: the label
 * names the source and seq range, the body carries the lines plus a hint for
 * reading the surrounding lines with the MCP log tool.
 * @param kind whether the lines come from a service or a port-forward
 * @param name the service or port-forward name
 * @param entries the lines to attach, oldest first; must be non-empty
 * @returns a chip ready for `ComposerHandle.attachContext`
 */
export function logContextChip(kind: LogSourceKind, name: string, entries: LogEntry[]) {
  const first = entries[0];
  const last = entries[entries.length - 1];
  const source = `${kind}:${name}`;
  const label = `${source} ${seqRange(first.seq, last.seq)}`;
  const when = utcRange(first.at, last.at);
  const tool =
    kind === "service"
      ? `read_service_logs(service: ${JSON.stringify(name)}`
      : `read_portforward_logs(name: ${JSON.stringify(name)}`;
  const after = Math.max(first.seq - HINT_CONTEXT_LINES, 0);
  const before = last.seq + 1 + HINT_CONTEXT_LINES;
  const body = [
    when ? `${label} (${when})` : label,
    "```",
    ...entries.map((e) => e.line),
    "```",
    `Surrounding lines: ${tool}, after: ${after}, before: ${before})`,
  ].join("\n");
  return { body, id: crypto.randomUUID(), label };
}
