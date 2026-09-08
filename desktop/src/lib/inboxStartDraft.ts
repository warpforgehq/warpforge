/**
 * The prompt a PR becomes when the user sends it to an agent. Deliberately
 * short: the agent can read the PR itself — what it needs up front is which
 * PR, where it lives, and the user's own words underneath.
 */

import type { PullRequestDetails, PullRequestSummary } from "@/protocol";

export function inboxStartPrompt(
  pr: PullRequestSummary,
  details?: PullRequestDetails | null,
): string {
  const title = (details?.title ?? pr.title).trim() || `pull request #${pr.number}`;
  const lines = [`Work on this GitHub pull request:`, "", `${pr.repo}#${pr.number} ${title}`];
  const url = pr.url.trim();
  if (url) lines.push(url);
  const base = (details?.baseRefName || pr.baseRefName).trim();
  const head = (details?.headRefName || pr.headRefName).trim();
  if (base && head) lines.push(`Branch: ${head} → ${base}`);
  const body = details?.body?.trim();
  if (body) lines.push("", body);
  return `${lines.join("\n")}\n`;
}
