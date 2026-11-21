/**
 * Client-side narrowing of the pull-request inbox. The daemon already
 * answers `assignedToMe` / state / search — these filters run over whatever
 * listing is in hand so a keystroke never costs a round trip, and so the
 * same helper narrows both the cross-project view and a single project's tab.
 */

import type { PullRequestSummary } from "@/protocol";

export const PULL_STATE_FILTERS = ["open", "all"] as const;
export type PullStateFilter = (typeof PULL_STATE_FILTERS)[number];

/** Whose pull requests to list: review asked of me, opened by me, or all. */
export const INBOX_SCOPES = ["review", "mine", "everyone"] as const;
export type InboxScope = (typeof INBOX_SCOPES)[number];

export interface InboxFilters {
  assignedToMe: boolean;
  scope: InboxScope;
  state: PullStateFilter;
  search: string;
}

export const DEFAULT_INBOX_SCOPE: InboxScope = "review";

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  assignedToMe: false,
  scope: DEFAULT_INBOX_SCOPE,
  state: "open",
  search: "",
};

/**
 * Whether a pull request belongs to a scope.
 *
 * @param pr The pull request.
 * @param scope The scope to test against.
 * @returns True when the pull request is listed under that scope.
 */
export function matchesInboxScope(pr: PullRequestSummary, scope: InboxScope): boolean {
  if (scope === "review") return pr.reviewRequested === true;
  if (scope === "mine") return pr.authoredByMe === true;
  return true;
}

/** What the daemon fetch should ask for, given the user's filters. */
export function inboxFetchState(filters: InboxFilters): PullStateFilter {
  return filters.state;
}

/** Whether anything narrows the listing — i.e. whether Reset earns its spot. */
export function hasActiveInboxFilters(filters: InboxFilters): boolean {
  return (
    filters.assignedToMe ||
    filters.scope !== DEFAULT_INBOX_SCOPE ||
    filters.state !== DEFAULT_INBOX_FILTERS.state ||
    filters.search !== ""
  );
}

export function matchesPullQuery(pr: PullRequestSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    pr.title,
    pr.repo,
    pr.project,
    `#${pr.number}`,
    String(pr.number),
    pr.author?.login ?? "",
    pr.headRefName,
    pr.baseRefName,
    ...pr.labels.map((label) => label.name),
    ...pr.assignees,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function applyInboxFilters(
  items: readonly PullRequestSummary[],
  filters: InboxFilters,
): PullRequestSummary[] {
  const scope = filters.scope;
  return items.filter((pr) => {
    if (!matchesInboxScope(pr, scope)) return false;
    if (filters.assignedToMe && pr.assignees.length === 0) return false;
    if (filters.state === "open" && pr.state !== "open") return false;
    return matchesPullQuery(pr, filters.search);
  });
}

export function sortInboxItems(items: readonly PullRequestSummary[]): PullRequestSummary[] {
  return [...items].sort(
    (a, b) =>
      (b.updatedAt || 0) - (a.updatedAt || 0) ||
      a.repo.localeCompare(b.repo) ||
      a.number - b.number,
  );
}
