import type {
  PullCommentResult,
  PullCommit,
  PullRequestDetails,
  PullRequestDiff,
  PullRequestSummary,
  PullThread,
} from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function PullMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  return class extends Base {
    /** One project's pull requests, newest update first. GitHub only. */
    async listPulls(
      project: string,
      options: {
        state?: "open" | "all";
        assignedToMe?: boolean;
        search?: string;
        limit?: number;
      } = {},
    ): Promise<PullRequestSummary[]> {
      const result = (await this.request("tracker.pulls.list", {
        project,
        state: options.state ?? "open",
        assigned_to_me: options.assignedToMe ?? false,
        search: options.search ?? "",
        limit: options.limit ?? 50,
      })) as { items?: PullRequestSummary[] };
      return result.items ?? [];
    }

    /** One pull request's body-level fields. */
    async pullDetails(project: string, number: number): Promise<PullRequestDetails> {
      return (await this.request("tracker.pulls.details", {
        number,
        project,
      })) as PullRequestDetails;
    }

    /** One pull request's changes: file stats plus the raw unified patch.
     *
     *  `range` narrows it to a slice of the pull request's commits — the
     *  comparison from `fromOid` (exclusive: the first selected commit's
     *  parent) to `toOid` (inclusive). */
    async pullDiff(
      project: string,
      number: number,
      range?: { fromOid: string; toOid: string } | null,
    ): Promise<PullRequestDiff> {
      return (await this.request("tracker.pulls.diff", {
        from_oid: range?.fromOid ?? "",
        number,
        project,
        to_oid: range?.toOid ?? "",
      })) as PullRequestDiff;
    }

    /** One pull request's commits, oldest first. */
    async pullCommits(project: string, number: number): Promise<PullCommit[]> {
      const result = (await this.request("tracker.pulls.commits", {
        number,
        project,
      })) as { items?: PullCommit[] };
      return result.items ?? [];
    }

    /** One pull request's conversation: comments, reviews, review threads. */
    async pullThread(project: string, number: number): Promise<PullThread> {
      return (await this.request("tracker.pulls.thread", {
        number,
        project,
      })) as PullThread;
    }

    /** Post a conversation comment, or reply on a review thread when
     *  `inReplyTo` carries the thread's node id. Returns the comment URL. */
    async postPullComment(
      project: string,
      number: number,
      body: string,
      inReplyTo?: string,
    ): Promise<string> {
      const result = (await this.request("tracker.pulls.comment", {
        body,
        in_reply_to: inReplyTo ?? "",
        number,
        project,
      })) as { url?: string };
      if (!result?.url) throw new Error("the daemon returned no comment URL");
      return result.url;
    }

    /** Submit a review verdict: `APPROVE`, `REQUEST_CHANGES` or `COMMENT`.
     *  `REQUEST_CHANGES` needs a non-empty body; the others may leave it empty.
     *  Returns the review's page URL. */
    async pullReview(
      project: string,
      number: number,
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
      body = "",
    ): Promise<string> {
      const result = (await this.request("tracker.pulls.review", {
        body,
        event,
        number,
        project,
      })) as { url?: string };
      if (!result?.url) throw new Error("the daemon returned no review URL");
      return result.url;
    }

    /** Start a new inline review thread on one line of a pull request's diff.
     *  `side` is `RIGHT` for a line of the post-image (added or unchanged) and
     *  `LEFT` for a line the diff deleted. Pass `startLine` (and optionally
     *  `startSide`, which defaults to `side`) to span `startLine`…`line`. */
    async createPullReviewComment(
      project: string,
      number: number,
      comment: {
        path: string;
        line: number;
        side: "LEFT" | "RIGHT";
        body: string;
        startLine?: number;
        startSide?: "LEFT" | "RIGHT";
      },
    ): Promise<PullCommentResult> {
      const { body, line, path, side, startLine, startSide } = comment;
      const result = (await this.request("tracker.pulls.reviewComment", {
        body,
        line,
        number,
        path,
        project,
        side,
        ...(startLine === undefined ? {} : { start_line: startLine }),
        ...(startSide === undefined ? {} : { start_side: startSide }),
      })) as Partial<PullCommentResult>;
      if (!result?.url) throw new Error("the daemon returned no comment URL");
      return { url: result.url };
    }
  };
}
