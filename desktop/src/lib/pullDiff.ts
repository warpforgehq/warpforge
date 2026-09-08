/**
 * Parsing a GitHub unified patch into renderable blocks. The daemon ships
 * the raw `diff` text (capped); this splits it into per-file hunks the
 * viewer can colour line by line — no CodeMirror, no both-sides document
 * fetch, just the patch GitHub already gave us.
 */

export type PatchLineKind = "add" | "del" | "context" | "meta";

export interface PatchLine {
  /** Stable within the parsed patch — the renderer's row key. */
  id: string;
  kind: PatchLineKind;
  text: string;
  oldNumber?: number;
  newNumber?: number;
}

export interface PatchHunk {
  /** Stable within the parsed patch — the renderer's block key. */
  id: string;
  /** The `@@ -a,b +c,d @@ …` header, verbatim. */
  header: string;
  oldStart: number;
  newStart: number;
  lines: PatchLine[];
}

export interface PatchFileBlock {
  path: string;
  /** Path on the removed side, when it differs (rename/deletion). */
  oldPath?: string;
  binary: boolean;
  hunks: PatchHunk[];
}

const NO_NEWLINE = "\\ No newline at end of file";
const DEV_NULL = "/dev/null";

/** Parse the whole patch. Unrecognizable content degrades to a single meta
 *  block rather than throwing — a truncated tail must still render. */
export function parseUnifiedPatch(patch: string): PatchFileBlock[] {
  const blocks: PatchFileBlock[] = [];
  const lines = patch.split("\n");
  let current: PatchFileBlock | null = null;
  let hunk: PatchHunk | null = null;
  let oldNumber = 0;
  let newNumber = 0;

  let seq = 0;

  const pushMetaLine = (text: string) => {
    if (!current) {
      current = { path: "", binary: false, hunks: [] };
      blocks.push(current);
    }
    current.hunks[0] ??= { id: `h${seq++}`, header: "", oldStart: 0, newStart: 0, lines: [] };
    current.hunks[0].lines.push({ id: `l${seq++}`, kind: "meta", text });
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      // Binary files carry no `+++` line, so the `diff --git` pair is the
      // fallback identity of the block; the +++/--- lines overwrite it.
      const fallback = /^diff --git (?:"?a\/(.*)"?) (?:"?b\/(.*)"?)$/.exec(line);
      current = {
        path: fallback?.[2] ?? "",
        oldPath: fallback?.[1],
        binary: false,
        hunks: [],
      };
      blocks.push(current);
      hunk = null;
      continue;
    }
    if (!current) {
      if (line.trim().length > 0) pushMetaLine(line);
      continue;
    }
    // `/dev/null` is git saying the file does not exist on that side — an
    // addition or a deletion. Taking it as a path put "/dev/null → x" in the
    // file header, and worse, made a deleted file render as a file called
    // "null" in a folder called "dev".
    if (line.startsWith("--- ")) {
      const from = stripAOrB(line.slice(4));
      if (from !== DEV_NULL) current.oldPath = from;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const to = stripAOrB(line.slice(4));
      if (to !== DEV_NULL) current.path = to;
      continue;
    }
    if (line.startsWith("new file mode") || line.startsWith("deleted file mode")) {
      // The +++/--- pair above (or below) carries the path; nothing to keep.
      continue;
    }
    if (line.startsWith("Binary files ")) {
      current.binary = true;
      continue;
    }
    if (line.startsWith("@@ ")) {
      const parsed = parseHunkHeader(line);
      hunk = {
        id: `h${seq++}`,
        header: line,
        oldStart: 0,
        newStart: 0,
        lines: [],
        ...(parsed ?? {}),
      };
      oldNumber = hunk.oldStart;
      newNumber = hunk.newStart;
      current.hunks.push(hunk);
      continue;
    }
    if (line === NO_NEWLINE) continue;
    if (!hunk) {
      // Everything else before the first hunk (index lines, mode lines) is
      // context GitHub does not render either.
      continue;
    }
    const tag = line.charAt(0);
    if (tag === "+") {
      hunk.lines.push({
        id: `l${seq++}`,
        kind: "add",
        text: line.slice(1),
        newNumber: newNumber++,
      });
    } else if (tag === "-") {
      hunk.lines.push({
        id: `l${seq++}`,
        kind: "del",
        text: line.slice(1),
        oldNumber: oldNumber++,
      });
    } else if (tag === " " || line === "") {
      hunk.lines.push({
        id: `l${seq++}`,
        kind: "context",
        text: line === "" ? "" : line.slice(1),
        oldNumber: oldNumber++,
        newNumber: newNumber++,
      });
    } else {
      hunk.lines.push({ id: `l${seq++}`, kind: "meta", text: line });
    }
  }
  return blocks.filter((block) => block.path || block.hunks.length > 0 || block.binary);
}

function stripAOrB(value: string): string {
  let path = value.trim();
  if (path.startsWith("a/") || path.startsWith("b/")) path = path.slice(2);
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1);
  return path.replace(/\t.*$/, "");
}

/** Parse one `@@` header. The `id` is filled in by the parser, which owns the
 *  numbering; `lines` starts empty here and accumulates in the caller. */
function parseHunkHeader(line: string): Omit<PatchHunk, "id"> | null {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) return null;
  return {
    header: line,
    oldStart: Number(match[1]),
    newStart: Number(match[3]),
    lines: [],
  };
}

/**
 * One row of the side-by-side view: the removed line on the left, the added
 * one on the right. Either side is null where the change has no counterpart
 * (a pure insertion, a pure deletion). Context lines carry the same line on
 * both sides, which is what makes them read as unchanged.
 */
export interface SplitRow {
  id: string;
  left: PatchLine | null;
  right: PatchLine | null;
}

/**
 * Pair one hunk's lines into side-by-side rows.
 *
 * Consecutive deletions and the additions that follow them are the same edit
 * seen from two sides, so they zip together row by row; whichever run is
 * longer spills into rows with an empty counterpart. This is a pure reshuffle
 * of the patch we already have — a split view costs no extra fetch, which is
 * the whole reason the inbox renders patches instead of documents.
 */
export function pairHunkLines(lines: readonly PatchLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let dels: PatchLine[] = [];
  let adds: PatchLine[] = [];

  const flush = () => {
    for (let index = 0; index < Math.max(dels.length, adds.length); index += 1) {
      const left = dels[index] ?? null;
      const right = adds[index] ?? null;
      rows.push({ id: `${left?.id ?? "_"}:${right?.id ?? "_"}`, left, right });
    }
    dels = [];
    adds = [];
  };

  for (const line of lines) {
    if (line.kind === "del") {
      dels.push(line);
      continue;
    }
    if (line.kind === "add") {
      adds.push(line);
      continue;
    }
    flush();
    // A context line is unchanged by definition, so both sides show it. Meta
    // lines belong to no side and render across the row.
    rows.push({
      id: line.id,
      left: line,
      right: line.kind === "context" ? line : null,
    });
  }
  flush();
  return rows;
}

/**
 * The text of one file's lines between two line numbers, on one side of the
 * diff. What a suggestion block is seeded with: GitHub replaces exactly the
 * commented range, so the proposal has to start as what is there now.
 *
 * Numbers are the side's own — `RIGHT` counts the post-image, `LEFT` the
 * pre-image — and lines the patch never showed are simply absent, which is
 * why this returns what it found rather than padding the gaps.
 */
export function linesInRange(
  block: PatchFileBlock,
  side: "LEFT" | "RIGHT",
  startLine: number,
  endLine: number,
): string[] {
  const out: string[] = [];
  for (const hunk of block.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "meta") continue;
      // A deletion has no post-image line, an addition no pre-image one.
      if (side === "RIGHT" && line.kind === "del") continue;
      if (side === "LEFT" && line.kind === "add") continue;
      const number = side === "RIGHT" ? line.newNumber : line.oldNumber;
      if (number === undefined || number < startLine || number > endLine) continue;
      out.push(line.text);
    }
  }
  return out;
}

export function countPatchStats(blocks: readonly PatchFileBlock[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const block of blocks) {
    for (const hunk of block.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === "add") additions += 1;
        else if (line.kind === "del") deletions += 1;
      }
    }
  }
  return { additions, deletions };
}

/** What a conversation-tab thread quotes: the line a comment sits on, plus a
 *  couple of its neighbours, in the same shape the diff renders. */
export interface PatchQuote {
  /** The post- or pre-image number of the anchor line, for the quote's ruler. */
  startNumber: number;
  lines: { kind: PatchLineKind; number: number; text: string }[];
}

/**
 * The patch block a thread's path belongs to: an exact match first, else the
 * same basename. GitHub keeps a thread on the path it was written against,
 * and a file that was renamed between pushes no longer carries that path —
 * the code, and the comment about it, are still there.
 */
export function findPatchBlock(
  blocks: readonly PatchFileBlock[],
  path: string,
): PatchFileBlock | undefined {
  const exact = blocks.find((block) => block.path === path);
  if (exact) return exact;
  const base = basenameOf(path);
  if (!base) return undefined;
  return blocks.find((block) => basenameOf(block.path) === base);
}

function basenameOf(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
}

/**
 * The anchor line's own text with `radius` lines of context around it, read
 * out of the parsed patch. GitHub's thread anchors are post-image numbers
 * (the line that still exists), so that side is searched first; a comment on
 * a removed line falls back to the pre-image. `null` when the patch no
 * longer carries the line — the quote simply does not render.
 */
export function quotePatchLines(
  block: PatchFileBlock,
  line: number,
  radius = 2,
): PatchQuote | null {
  const lines = block.hunks.flatMap((hunk) => hunk.lines).filter((l) => l.kind !== "meta");
  const anchor = anchorIndex(lines, line);
  if (anchor < 0) return null;
  const start = Math.max(0, anchor - radius);
  const quoted = lines.slice(start, Math.min(lines.length, anchor + radius + 1));
  return {
    startNumber: quoted[0].newNumber ?? quoted[0].oldNumber ?? line,
    lines: quoted.map((l) => ({
      kind: l.kind,
      number: l.newNumber ?? l.oldNumber ?? 0,
      text: l.text,
    })),
  };
}

/**
 * The index of the line a thread anchors to: an exact hit on either image.
 * There is deliberately no "nearest line" fallback — after a quote showed a
 * table's columns under a comment about a schema header, quoting whatever
 * wears the same number today reads as a lie. A stale thread quotes its own
 * diffHunk or nothing.
 */
function anchorIndex(lines: readonly PatchLine[], line: number): number {
  const exact = lines.findIndex((l) => l.newNumber === line);
  if (exact >= 0) return exact;
  return lines.findIndex((l) => l.oldNumber === line);
}

/**
 * The quote a conversation card shows for a thread, taken from the comment's
 * own `diffHunk` — the hunk as it stood when the comment was written.
 *
 * This is the authoritative source: a thread on an outdated diff must quote
 * its own version. Quoting the current patch instead matched whatever lines
 * now wear the same numbers, which once showed a schema's table columns under
 * a comment about its header comments. `startLine`/`line` are the commented
 * version's numbers (the daemon falls back to the `original*` pair).
 */
export function quoteFromDiffHunk(
  diffHunk: string,
  line: number,
  startLine?: number | null,
  radius = 2,
): PatchQuote | null {
  const rows = diffHunk.split("\n");
  // The hunk arrives as `@@ -a,b +c,d @@ …` plus its body; without a header
  // there is no numbering to trust, so there is nothing to quote.
  const header = rows.find((row) => row.startsWith("@@"));
  if (!header) return null;
  const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
  if (!match) return null;
  // Counters start AT the header's start line: the first body row wears that
  // number, not one below it.
  let newNumber = Number(match[1]);
  let oldNumber = Number(/@@ -(\d+)/.exec(header)?.[1] ?? "1");
  const parsed = rows
    .slice(rows.indexOf(header) + 1)
    .filter((row) => row.length > 0)
    .map((row): PatchLine | null => {
      const kind =
        row[0] === "+" ? "add" : row[0] === "-" ? "del" : row.startsWith("\\") ? "meta" : "context";
      if (kind === "meta") return null;
      const text = kind === "context" || kind === "add" || kind === "del" ? row.slice(1) : row;
      const entry: PatchLine = {
        id: `${newNumber}:${oldNumber}:${text}`,
        kind,
        text,
        ...(kind === "add"
          ? { newNumber }
          : kind === "del"
            ? { oldNumber }
            : { newNumber, oldNumber }),
      };
      if (kind !== "del") newNumber += 1;
      if (kind !== "add") oldNumber += 1;
      return entry;
    })
    .filter((row): row is PatchLine => row !== null);

  const first = startLine ?? line;
  // Anchor on the commented version's numbers — the hunk IS that version.
  const anchor = parsed.findIndex((row) => row.newNumber === line || row.oldNumber === line);
  if (anchor < 0) return null;
  const rangeStart = startLine
    ? parsed.findIndex((row) => row.newNumber === first || row.oldNumber === first)
    : anchor;
  const from = rangeStart >= 0 ? rangeStart : anchor;
  const lo = Math.max(0, from - radius);
  const hi = Math.min(parsed.length, anchor + radius + 1);
  const quoted = parsed.slice(lo, hi);
  if (quoted.length === 0) return null;
  return {
    startNumber: quoted[0].newNumber ?? quoted[0].oldNumber ?? line,
    lines: quoted.map((row) => ({
      kind: row.kind,
      number: row.newNumber ?? row.oldNumber ?? 0,
      text: row.text,
    })),
  };
}
