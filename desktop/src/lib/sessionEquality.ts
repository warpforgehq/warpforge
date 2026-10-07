import type { EditHunk, SessionUpdate } from "../protocol";
import type { TranscriptListRow } from "./sessionStream";

function hunksEqual(a?: EditHunk[], b?: EditHunk[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((hunk, i) => {
    const other = b[i];
    return (
      hunk.oldStart === other.oldStart &&
      hunk.oldLines === other.oldLines &&
      hunk.newStart === other.newStart &&
      hunk.newLines === other.newLines &&
      hunk.lines.length === other.lines.length &&
      hunk.lines.every((line, j) => line === other.lines[j])
    );
  });
}

export function sessionUpdatesSemanticallyEqual(a: SessionUpdate, b: SessionUpdate): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  // Value-aware comparison for streaming-prone fields; avoids remount churn
  // when agent_text creates new object per token (previous.text + delta).
  switch (a.kind) {
    case "agent_text":
    case "agent_thought":
      return a.text === (b as typeof a).text;
    case "user_message":
      return a.text === (b as typeof a).text;
    case "tool_call":
      return (
        a.tool_call_id === (b as typeof a).tool_call_id &&
        a.status === (b as typeof a).status &&
        a.title === (b as typeof a).title &&
        a.content === (b as typeof a).content &&
        a.tool_kind === (b as typeof a).tool_kind &&
        a.started_at === (b as typeof a).started_at &&
        // A prompt arriving on, or clearing from, this row has to re-render it.
        a.pendingPermission?.request_id === (b as typeof a).pendingPermission?.request_id
      );
    case "file_edit":
      return (
        a.path === (b as typeof a).path &&
        a.additions === (b as typeof a).additions &&
        a.deletions === (b as typeof a).deletions &&
        a.tool_call_id === (b as typeof a).tool_call_id &&
        hunksEqual(a.hunks, (b as typeof a).hunks)
      );
    case "permission_request":
      return (
        a.request_id === (b as typeof a).request_id &&
        a.title === (b as typeof a).title &&
        a.options.length === (b as typeof a).options.length &&
        a.options.every((o, i) => o === (b as typeof a).options[i])
      );
    case "permission_resolved":
      return a.request_id === (b as typeof a).request_id && a.outcome === (b as typeof a).outcome;
    case "plan":
      return JSON.stringify(a.entries) === JSON.stringify((b as typeof a).entries);
    case "usage":
      return a.used === (b as typeof a).used && a.size === (b as typeof a).size;
    case "turn_ended":
      return a.stop_reason === (b as typeof a).stop_reason;
    case "workflow_event":
      return (
        a.event === (b as typeof a).event &&
        a.title === (b as typeof a).title &&
        a.detail === (b as typeof a).detail &&
        a.tone === (b as typeof a).tone
      );
    case "advisor_consultation":
      return (
        a.question === (b as typeof a).question &&
        a.answer === (b as typeof a).answer &&
        a.outcome === (b as typeof a).outcome &&
        a.advisor_task_id === (b as typeof a).advisor_task_id
      );
    case "html_render":
      return (
        a.render_id === (b as typeof a).render_id &&
        a.title === (b as typeof a).title &&
        a.height === (b as typeof a).height
      );
    case "prompt_capabilities":
      return (
        a.image === (b as typeof a).image && a.embedded_context === (b as typeof a).embedded_context
      );
    case "available_commands":
      return a.commands === (b as typeof a).commands;
    default:
      // Reference equality for anything unforeseen; a new kind should be added
      // here rather than silently churning.
      return false;
  }
}

export function transcriptRowsAreEqual(
  previous: TranscriptListRow,
  next: TranscriptListRow,
): boolean {
  if (previous.kind !== next.kind || previous.id !== next.id) return false;
  if (previous.kind === "update" && next.kind === "update") {
    if (
      previous.entry.mergedIndex !== next.entry.mergedIndex ||
      previous.thinkingActive !== next.thinkingActive ||
      previous.textStreaming !== next.textStreaming
    )
      return false;
    if (previous.entry.update === next.entry.update) return true;
    return sessionUpdatesSemanticallyEqual(previous.entry.update, next.entry.update);
  }
  if (previous.kind === "activity" && next.kind === "activity") {
    return activityRowsAreEqual(previous, next);
  }
  return false;
}

function activityRowsAreEqual(
  previous: Extract<TranscriptListRow, { kind: "activity" }>,
  next: Extract<TranscriptListRow, { kind: "activity" }>,
): boolean {
  if (
    previous.groupId !== next.groupId ||
    previous.live !== next.live ||
    previous.hasFailure !== next.hasFailure ||
    previous.hasPendingApproval !== next.hasPendingApproval ||
    previous.expandable !== next.expandable ||
    previous.open !== next.open ||
    previous.summary.text !== next.summary.text ||
    previous.items.length !== next.items.length
  ) {
    return false;
  }
  return previous.items.every((item, index) => {
    const other = next.items[index];
    return (
      item.key === other.key &&
      (item.entry.update === other.entry.update ||
        sessionUpdatesSemanticallyEqual(item.entry.update, other.entry.update))
    );
  });
}
