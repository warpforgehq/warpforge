import type { PullRequestFile } from "@/protocol";

/**
 * What a changed file is, for the overview's file list.
 *
 * A pull request's file list answers one question before any other: how much
 * of this is code I have to think about, and how much is prose, boilerplate,
 * or a lockfile that came along with it. So the overview groups by that
 * instead of by folder — the folder tree already exists on the Diff tab,
 * where you navigate rather than triage.
 *
 * The groups are about the *kind of attention* a file needs, not where it
 * lives: a migration is a handful of lines you read carefully because it
 * touches data, a lockfile is a thousand lines you skip. A folder tree cannot
 * say either.
 */
export type PullFileGroupId =
  | "migrations"
  | "implementation"
  | "tests"
  | "config"
  | "generated"
  | "docs";

/**
 * How much a group is worth reading. `critical` is small and deserves the
 * front, `noise` is folded and dimmed because it is the tail you scroll past.
 */
export type PullFileGroupTone = "critical" | "normal" | "noise";

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
  tone: PullFileGroupTone;
  /** Whether the overview opens this group before the reviewer touches it. */
  defaultOpen: boolean;
  files: PullGroupedFile[];
  additions: number;
  deletions: number;
}

/** Display order and personality, one entry per group. `order` is what the
 *  list sorts on: the expensive-to-get-wrong group leads, the noise trails.
 *  Nothing opens by default — a 64-file list is six headings until you choose
 *  a block — except a group that is the whole list, which has nothing to
 *  decide between and opens so the list never reads as empty. */
const GROUP_META: Record<
  PullFileGroupId,
  { label: string; tone: PullFileGroupTone; defaultOpen: boolean; order: number }
> = {
  migrations: { defaultOpen: false, label: "Migrations", order: 0, tone: "critical" },
  implementation: { defaultOpen: false, label: "Implementation", order: 1, tone: "normal" },
  tests: { defaultOpen: false, label: "Tests", order: 2, tone: "normal" },
  config: { defaultOpen: false, label: "Config & CI", order: 3, tone: "normal" },
  generated: { defaultOpen: false, label: "Generated", order: 4, tone: "noise" },
  docs: { defaultOpen: false, label: "Documentation", order: 5, tone: "normal" },
};

const DOC_EXTENSIONS = [".md", ".mdx", ".markdown", ".rst", ".jsonl"];
const DOC_SEGMENTS = new Set(["doc", "docs", "dataset", "datasets"]);
const DATASET_SEGMENTS = new Set(["dataset", "datasets", "fixtures"]);

/** Folders whose whole contents are a database migration, whatever the tool:
 *  Rails' `db/migrate`, Prisma/Alembic/SQLx/`golang-migrate` `migrations/`,
 *  and Drizzle's default `drizzle/` output (which also carries the `meta/`
 *  journal and snapshots as JSON). */
const MIGRATION_SEGMENTS = new Set(["migrate", "migrations", "drizzle"]);

const TEST_SEGMENTS = new Set(["__tests__", "e2e", "spec", "specs", "test", "testdata", "tests"]);

/** Lockfiles are the canonical generated file: real, huge, and never read. */
const LOCKFILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "yarn.lock",
]);

const GENERATED_SEGMENTS = new Set([
  "__generated__",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "vendor",
]);

const GENERATED_SUFFIXES = [
  ".min.css",
  ".min.js",
  ".pb.go",
  ".pb.ts",
  ".gen.ts",
  ".gen.tsx",
  ".generated.ts",
  ".generated.tsx",
  "_pb2.py",
  "_pb2_grpc.py",
];

/** Where the build/CI plumbing lives — a file you skim for intent, not a file
 *  whose logic you trace. */
const CONFIG_SEGMENTS = new Set([
  ".buildkite",
  ".circleci",
  ".github",
  "ci",
  "charts",
  "helm",
  "k8s",
  "kubernetes",
  "terraform",
]);

/** Split a path into its directory and basename, lowercased for matching. */
function lowerParts(path: string): { base: string; segments: string[] } {
  const lower = path.toLowerCase();
  const cut = lower.lastIndexOf("/");
  const base = cut >= 0 ? lower.slice(cut + 1) : lower;
  const segments = lower.split("/").slice(0, -1).filter(Boolean);
  return { base, segments };
}

function isMigration(path: string): boolean {
  const { base, segments } = lowerParts(path);
  if (base.endsWith(".sql")) return true;
  return segments.some((segment) => MIGRATION_SEGMENTS.has(segment));
}

function isGenerated(path: string): boolean {
  const { base, segments } = lowerParts(path);
  if (LOCKFILE_NAMES.has(base)) return true;
  if (base.endsWith(".snap")) return true;
  if (GENERATED_SUFFIXES.some((suffix) => base.endsWith(suffix))) return true;
  return segments.some((segment) => GENERATED_SEGMENTS.has(segment));
}

function isTest(path: string): boolean {
  const { base, segments } = lowerParts(path);
  // The language conventions, not a blanket `_test`: `foo.test.ts` and
  // `foo.spec.tsx` anywhere, `foo_test.go` and `test_foo.py` in their
  // languages. A blanket `_test` would swallow `documentation_test.rs`.
  if (/\.(test|spec)\.[^.]+$/.test(base)) return true;
  if (base.endsWith("_test.go")) return true;
  if (base.startsWith("test_") && base.endsWith(".py")) return true;
  return segments.some((segment) => TEST_SEGMENTS.has(segment));
}

function isConfig(path: string): boolean {
  const { base, segments } = lowerParts(path);
  if (base.startsWith("dockerfile") || base.startsWith("docker-compose")) return true;
  if (base.startsWith("compose.") || base === "compose.yml") return true;
  if (base.endsWith(".tf") || base.endsWith(".tfvars")) return true;
  return segments.some((segment) => CONFIG_SEGMENTS.has(segment));
}

function isDoc(path: string): boolean {
  const { base, segments } = lowerParts(path);
  if (DOC_EXTENSIONS.some((extension) => base.endsWith(extension))) return true;
  return segments.some((segment) => DOC_SEGMENTS.has(segment));
}

/**
 * Which group a path belongs to, by the path alone.
 *
 * Path heuristics, not GitHub metadata: the wire shape carries a path and two
 * counts, and asking the daemon to classify would put a UI opinion in the
 * protocol. Rules run most-specific first — a lockfile is generated even if it
 * sits in a test folder, and a `.sql` is a migration wherever it lives.
 * Everything unmatched is implementation, because that is the safe default: a
 * file misfiled as prose is a file the reviewer skips.
 */
export function pullFileGroupOf(path: string): PullFileGroupId {
  if (isMigration(path)) return "migrations";
  if (isGenerated(path)) return "generated";
  if (isTest(path)) return "tests";
  if (isDoc(path)) return "docs";
  if (isConfig(path)) return "config";
  return "implementation";
}

/** The `dataset` note, when a path sits in one. */
function pullFileTag(path: string): "dataset" | undefined {
  const { base, segments } = lowerParts(path);
  if (base.endsWith(".jsonl")) return "dataset";
  return segments.some((segment) => DATASET_SEGMENTS.has(segment)) ? "dataset" : undefined;
}

/**
 * The changed files as groups, ordered by how much attention they are worth,
 * each with its own totals. An empty group is dropped rather than rendered as
 * a heading over nothing.
 */
export function groupPullFiles(files: readonly PullRequestFile[]): PullFileGroup[] {
  const groups = new Map<PullFileGroupId, PullFileGroup>();
  const groupFor = (id: PullFileGroupId): PullFileGroup =>
    groups.get(id) ?? {
      additions: 0,
      defaultOpen: GROUP_META[id].defaultOpen,
      deletions: 0,
      files: [],
      id,
      label: GROUP_META[id].label,
      tone: GROUP_META[id].tone,
    };

  for (const file of files) {
    const id = pullFileGroupOf(file.path);
    const group = groupFor(id);
    groups.set(id, group);
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
  return [...groups.values()].sort((a, b) => GROUP_META[a.id].order - GROUP_META[b.id].order);
}
