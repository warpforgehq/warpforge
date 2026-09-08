import { prIdentityBlock } from "@/lib/inboxTaskPrompt";
import { groupPullFiles } from "@/lib/pullFileGroups";
import type { PullRequestDetails, PullRequestDiff, PullRequestSummary } from "@/protocol";

export type PrAssistantIntent = "explain" | "review";

/**
 * Below this the whole diff goes in the prompt; above it, only the file list
 * and the command to fetch it. Inlining a large patch cost the context twice —
 * once for the text, and again when the agent read the files anyway.
 */
export const INLINE_PATCH_MAX_BYTES = 8 * 1024;

const FILE_LIST_LIMIT = 40;

const EXPLAIN_TASK = `Explain this pull request to someone who has not read it.

Three short sections, nothing else:

**What it does** — the intent in a few sentences. Not a file-by-file readout.

**How it works** — the new control flow as pseudocode: at most 12 lines,
simplified names, no line numbers, no verbatim regexes or literals. Skip this
section entirely if the change has no flow worth walking.

**Where to look first** — two or three files, and what to check in each.

Add a \`\`\`mermaid diagram (at most 8 nodes) only when the shape is genuinely
easier to see than to read: a new flow, a state machine, a sequence across
services. A change that is a list of edits gets no diagram.

Aim for something that reads in a minute.`;

const REVIEW_TASK = `Review this pull request critically. You are the last reader before it merges.

Findings only — no summary of the change, no diagram, no pseudocode. Order
them worst first, and stop at the five that matter:

For each: what breaks, in what circumstance, at which \`path:line\`, and the
smallest fix. Say "risk", "missing test" or "nit" at the front so the
developer can triage by scanning.

Then one line: what you could not verify, if anything.

If nothing is worth flagging, say that in one sentence rather than padding the
list.`;

/** Both openings share the context; only the task on top differs. */
export function prAssistantPrompt({
  intent,
  pr,
  details,
  diff,
}: {
  intent: PrAssistantIntent;
  pr: PullRequestSummary;
  details?: PullRequestDetails | null;
  /** The whole-PR diff, when the review pane has already fetched it. */
  diff?: PullRequestDiff | null;
}): string {
  const parts = [
    intent === "explain" ? EXPLAIN_TASK : REVIEW_TASK,
    "",
    prIdentityBlock(pr, details),
  ];

  const additions = details?.additions ?? pr.additions ?? 0;
  const deletions = details?.deletions ?? pr.deletions ?? 0;
  const changedFiles = details?.changedFiles ?? pr.changedFiles ?? diff?.files.length ?? 0;
  if (additions || deletions || changedFiles) {
    parts.push(
      "",
      `Size: +${additions} −${deletions} across ${changedFiles} ${
        changedFiles === 1 ? "file" : "files"
      }.`,
    );
  }

  const body = details?.body?.trim();
  if (body) parts.push("", "What it says about itself:", "", quote(body));

  const inline = !!diff?.patch && diff.patch.length <= INLINE_PATCH_MAX_BYTES;
  if (diff?.files.length) parts.push("", "Files changed:", fileList(diff));

  if (inline && diff?.patch) {
    parts.push("", "The whole diff, so you do not need to fetch it:");
    parts.push("```diff", diff.patch.trimEnd(), "```");
  } else {
    parts.push("", readTheDiff(pr, details));
  }
  if (diff?.truncated) {
    parts.push("", "GitHub truncated its own patch at a size cap, so read from git, not from it.");
  }

  return `${parts.join("\n")}\n`;
}

/**
 * How to get the diff, for a change too big to paste. Read-only on purpose:
 * this session runs in the developer's own working tree, so it fetches and
 * diffs `origin` refs and never switches a branch under them.
 */
function readTheDiff(pr: PullRequestSummary, details?: PullRequestDetails | null): string {
  const base = (details?.baseRefName || pr.baseRefName).trim() || "main";
  const head = (details?.headRefName || pr.headRefName).trim();
  if (!head) return "Read the pull request on GitHub for its diff.";
  return [
    "Read the diff once, for the files you actually need — do not re-read what",
    "is already above. This is the developer's working tree: fetch and diff,",
    "never switch or check out a branch here.",
    "",
    "```sh",
    `git fetch origin ${base} ${head}`,
    `git diff origin/${base}...origin/${head} -- <path>   # one file, or omit for all`,
    "```",
    "",
    `\`gh pr diff ${pr.number}\` works too, when the \`gh\` CLI is set up.`,
  ].join("\n");
}

function fileList(diff: PullRequestDiff): string {
  const lines: string[] = [];
  for (const group of groupPullFiles(diff.files)) {
    lines.push(`${group.label} (${group.files.length}, +${group.additions} −${group.deletions}):`);
    const shown = group.files.slice(0, FILE_LIST_LIMIT);
    for (const file of shown) lines.push(`- ${file.path}  +${file.additions} −${file.deletions}`);
    if (group.files.length > shown.length) {
      lines.push(`- …and ${group.files.length - shown.length} more`);
    }
  }
  return lines.join("\n");
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}
