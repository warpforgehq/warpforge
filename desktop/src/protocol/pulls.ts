// ── Pull-request inbox ──────────────────────────────────────────────────────

/** One person on a pull request, as rows and headers render them. */
export interface PullActor {
  login: string;
  avatarUrl?: string | null;
}

/** One label with GitHub's colour (`RRGGBB`), so chips match github.com. */
export interface PullLabel {
  name: string;
  color?: string | null;
}

/** One pull request in the inbox listing. */
export interface PullRequestSummary {
  /** Local project the PR belongs to (daemon fills it, one repo can be
   *  checked out under several project names). */
  project: string;
  /** `owner/name`. */
  repo: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged" | string;
  draft: boolean;
  author?: PullActor | null;
  labels: PullLabel[];
  assignees: string[];
  baseRefName: string;
  headRefName: string;
  reviewDecision?: string | null;
  createdAt: number;
  updatedAt: number;
  /** Diff size, so the list rail renders `+312/−89` without a per-row fetch.
   *  The daemon always sends it (zero when the source could not supply it);
   *  optional here so older cached rows and test fixtures still type-check. */
  additions?: number;
  deletions?: number;
  changedFiles?: number;
}

/** Body-level fields of one pull request, for the detail pane. */
export interface PullRequestDetails {
  title: string;
  url: string;
  state: string;
  draft: boolean;
  body: string;
  author?: PullActor | null;
  baseRefName: string;
  headRefName: string;
  reviewDecision?: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
}

/** One file inside a pull request's changes. */
export interface PullRequestFile {
  path: string;
  additions: number;
  deletions: number;
}

/** The changes of one pull request. `patch` is a raw unified diff, capped —
 *  `truncated` says the tail was cut rather than shipped. */
export interface PullRequestDiff {
  additions: number;
  deletions: number;
  files: PullRequestFile[];
  patch: string;
  truncated: boolean;
}

/** One commit on a pull request. `parentOid` is what makes a range
 *  selectable client-side: the patch for commits `i..=j` is the comparison
 *  from `commits[i].parentOid` to `commits[j].oid`. */
export interface PullCommit {
  oid: string;
  abbreviatedOid: string;
  /** First parent; empty for a root commit, which cannot be a range base. */
  parentOid: string;
  messageHeadline: string;
  /** RFC-3339 as GitHub emitted it. */
  committedDate: string;
  author?: PullActor | null;
}

/** One comment-shaped node of a pull request conversation. */
export interface PullComment {
  id: string;
  /** `comment` (issue comment), `review` (review body), or `review_comment`
   *  (inline on a diff line). */
  kind: "comment" | "review" | "review_comment" | string;
  author?: PullActor | null;
  body: string;
  /** RFC-3339 as GitHub emitted it. */
  createdAt: string;
  url: string;
  state?: string;
  path?: string;
  line?: number | null;
  /** First line of the range the comment covers; `line` is the last. */
  startLine?: number | null;
  /** The numbers as of the version the comment was written against — what
   *  remains valid once the diff has moved on. */
  originalLine?: number | null;
  originalStartLine?: number | null;
  /** The hunk as it stood when the comment was written: the authoritative
   *  quote source for a thread on an outdated diff. */
  diffHunk?: string;
  /** GraphQL node id of the review thread — what a reply addresses. */
  threadId?: string;
  resolved?: boolean;
  replies: PullComment[];
}

/** A pull request conversation: every node, time-ordered. */
export interface PullThread {
  comments: PullComment[];
  truncated: boolean;
  reviewDecision?: string | null;
  baseRefName: string;
  headRefName: string;
}

/** What a write to a pull request answers with: the created comment's URL.
 *  `tracker.pulls.reviewComment` takes `{ project, number, path, line, side,
 *  body }`, where `side` is `RIGHT` for a line of the post-image (added or
 *  unchanged) and `LEFT` for a line the diff deleted. */
export interface PullCommentResult {
  url: string;
}
