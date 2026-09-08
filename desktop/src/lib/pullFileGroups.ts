import type { PullRequestFile } from "@/protocol";

/**
 * What a changed file is, for the overview's file list.
 *
 * A pull request's file list answers one question before any other: how much
 * of this is code I have to think about, and how much is prose that came
 * along with it. So the overview groups by that instead of by folder — the
 * folder tree already exists on the Diff tab, where you navigate rather than
 * triage.
 */
export type PullFileGroupId = "implementation" | "documentation";

export interface PullGroupedFile {
  path: string;
  /** Basename — what the row leads with. */
  name: string;
  /** The directory it sits in, rendered muted behind the name. */
  dir: string;
  additions: number;
  deletions: number;
  /** A one-word note when the path says something the name does not. */
  tag?: "dataset";
}

export interface PullFileGroup {
  id: PullFileGroupId;
  label: string;
  files: PullGroupedFile[];
  additions: number;
  deletions: number;
}

const DOC_EXTENSIONS = [".md", ".mdx", ".markdown", ".rst", ".jsonl"];
const DOC_SEGMENTS = new Set(["doc", "docs", "dataset", "datasets"]);
const DATASET_SEGMENTS = new Set(["dataset", "datasets", "fixtures"]);

/**
 * Which group a path belongs to, by the path alone.
 *
 * Path heuristics, not GitHub metadata: the wire shape carries a path and two
 * counts, and asking the daemon to classify would put a UI opinion in the
 * protocol. Prose, docs folders and datasets are documentation; everything
 * else is implementation, because that is the safe default — a file
 * misfiled as prose is a file the reviewer skips.
 */
export function pullFileGroupOf(path: string): PullFileGroupId {
  const lower = path.toLowerCase();
  if (DOC_EXTENSIONS.some((extension) => lower.endsWith(extension))) return "documentation";
  const segments = lower.split("/").slice(0, -1);
  if (segments.some((segment) => DOC_SEGMENTS.has(segment))) return "documentation";
  return "implementation";
}

/** The `dataset` note, when a path sits in one. */
function pullFileTag(path: string): "dataset" | undefined {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jsonl")) return "dataset";
  const segments = lower.split("/").slice(0, -1);
  return segments.some((segment) => DATASET_SEGMENTS.has(segment)) ? "dataset" : undefined;
}

/**
 * The changed files as at most two groups, implementation first, each with
 * its own totals. An empty group is dropped rather than rendered as a
 * heading over nothing.
 */
export function groupPullFiles(files: readonly PullRequestFile[]): PullFileGroup[] {
  const groups: Record<PullFileGroupId, PullFileGroup> = {
    documentation: {
      additions: 0,
      deletions: 0,
      files: [],
      id: "documentation",
      label: "Documentation",
    },
    implementation: {
      additions: 0,
      deletions: 0,
      files: [],
      id: "implementation",
      label: "Implementation",
    },
  };
  for (const file of files) {
    const group = groups[pullFileGroupOf(file.path)];
    const cut = file.path.lastIndexOf("/");
    group.files.push({
      additions: file.additions,
      deletions: file.deletions,
      dir: cut > 0 ? file.path.slice(0, cut) : "",
      name: cut >= 0 ? file.path.slice(cut + 1) : file.path,
      path: file.path,
      tag: pullFileTag(file.path),
    });
    group.additions += file.additions;
    group.deletions += file.deletions;
  }
  // Documentation first: it is the short group, and under a 46-file
  // implementation list it never got on screen at all.
  return [groups.documentation, groups.implementation].filter((group) => group.files.length > 0);
}
