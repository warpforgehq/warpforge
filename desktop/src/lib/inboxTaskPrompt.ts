import { groupPullFiles } from "@/lib/pullFileGroups";
import type {
  PullComment,
  PullRequestDetails,
  PullRequestFile,
  PullRequestSummary,
  PullThread,
} from "@/protocol";

/**
 * Work that wants a board task of its own: act on the review's remarks, or
 * keep building the branch. Explaining a PR belongs to the Assistant tab.
 */
export type InboxTaskIntent = "comments" | "branch";

/** Which pull request this is, for a prompt's opening lines. */
export function prIdentityBlock(
  pr: PullRequestSummary,
  details?: PullRequestDetails | null,
): string {
  const title = (details?.title ?? pr.title).trim() || `pull request #${pr.number}`;
  const base = (details?.baseRefName || pr.baseRefName).trim();
  const head = (details?.headRefName || pr.headRefName).trim();
  const lines = [`${pr.repo}#${pr.number} ${title}`];
  const url = pr.url.trim();
  if (url) lines.push(url);
  if (base && head) lines.push(`Branch: ${head} → ${base}`);
  return lines.join("\n");
}

/** Remarks nobody has acted on: inline comments and "changes requested"
 *  bodies. A resolved thread or a bare approval is not work. */
export function unresolvedReviewComments(thread: PullThread | null): PullComment[] {
  return (thread?.comments ?? []).filter((comment) => {
    if (comment.resolved) return false;
    if (comment.kind === "review_comment") return !!comment.body.trim();
    if (comment.kind === "review") {
      return comment.state === "CHANGES_REQUESTED" && !!comment.body.trim();
    }
    return false;
  });
}

/** Body bytes per comment; the rest stays on GitHub. */
const COMMENT_BODY_LIMIT = 1_200;

/** How many paths the file list names before it starts counting instead. */
const FILE_LIST_LIMIT = 30;

export function inboxTaskPrompt({
  intent,
  pr,
  details,
  thread,
  files,
}: {
  intent: InboxTaskIntent;
  pr: PullRequestSummary;
  details?: PullRequestDetails | null;
  thread?: PullThread | null;
  /** The changed files, when the review pane has them. */
  files?: readonly PullRequestFile[] | null;
}): string {
  const head = (details?.headRefName || pr.headRefName).trim();
  const parts: string[] = [];

  parts.push(
    intent === "comments"
      ? "Address the review comments on this pull request."
      : "Continue the work on this pull request.",
  );
  parts.push("", prIdentityBlock(pr, details));

  if (head) {
    parts.push(
      "",
      `Work on its own branch, not on ${(details?.baseRefName || pr.baseRefName).trim() || "the base branch"}:`,
      "",
      "```sh",
      `git fetch origin ${head} && git switch ${head}`,
      "```",
    );
  }

  if (intent === "comments") {
    const comments = unresolvedReviewComments(thread ?? null);
    parts.push(
      "",
      comments.length > 0
        ? `Fix each of the ${comments.length} unresolved ${
            comments.length === 1 ? "comment" : "comments"
          } below, then commit and push. Where a comment is wrong or you disagree, leave the code alone and say why — do not change working code to satisfy a bad review.`
        : "There are no unresolved review comments on it right now. Check the pull request on GitHub before changing anything.",
    );
    if (comments.length > 0) parts.push("", formatComments(comments));
  } else {
    const body = details?.body?.trim();
    if (body) parts.push("", "What the pull request says about itself:", "", quote(body));
    parts.push(
      "",
      "Pick up where it left off: read the branch, then finish what is unfinished. Commit and push to the same branch. Ask before changing the shape of the change.",
    );
  }

  const stats = sizeLine(pr, details, files);
  if (stats) parts.push("", stats);
  if (files?.length) parts.push("", "Files it touches:", fileList(files));

  return `${parts.join("\n")}\n`;
}

function sizeLine(
  pr: PullRequestSummary,
  details?: PullRequestDetails | null,
  files?: readonly PullRequestFile[] | null,
): string | null {
  const additions = details?.additions ?? pr.additions ?? 0;
  const deletions = details?.deletions ?? pr.deletions ?? 0;
  const changed = details?.changedFiles ?? pr.changedFiles ?? files?.length ?? 0;
  if (!additions && !deletions && !changed) return null;
  return `Size: +${additions} −${deletions} across ${changed} ${changed === 1 ? "file" : "files"}.`;
}

function fileList(files: readonly PullRequestFile[]): string {
  const lines: string[] = [];
  for (const group of groupPullFiles(files)) {
    const shown = group.files.slice(0, FILE_LIST_LIMIT);
    lines.push(`${group.label} (${group.files.length}):`);
    for (const file of shown) lines.push(`- ${file.path}`);
    if (group.files.length > shown.length) {
      lines.push(`- …and ${group.files.length - shown.length} more`);
    }
  }
  return lines.join("\n");
}

/** One numbered list of remarks, each with where it points. */
function formatComments(comments: readonly PullComment[]): string {
  return comments
    .map((comment, index) => {
      const who = comment.author?.login || "a reviewer";
      const where =
        comment.kind === "review_comment"
          ? ` — ${comment.path ?? "unknown file"}${
              comment.line || comment.originalLine ? `:${comment.line ?? comment.originalLine}` : ""
            }`
          : " — review, changes requested";
      const replies =
        comment.replies.length > 0
          ? `\n   (${comment.replies.length} ${
              comment.replies.length === 1 ? "reply" : "replies"
            } in the thread on GitHub)`
          : "";
      return `${index + 1}. ${who}${where}\n${indent(trim(comment.body))}${replies}`;
    })
    .join("\n\n");
}

function trim(body: string): string {
  const text = body.trim();
  return text.length > COMMENT_BODY_LIMIT
    ? `${text.slice(0, COMMENT_BODY_LIMIT).trimEnd()}\n… (truncated — read the rest on GitHub)`
    : text;
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `   ${line}`)
    .join("\n");
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}
