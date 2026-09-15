/** One run of tool output: prose, a fenced code block, a diff, or a table. */
export type ToolOutputBlock =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string | null; label: string | null; text: string }
  | { kind: "diff"; text: string }
  | {
      kind: "table";
      /** The source lines, kept for keys and for copying the block as text. */
      text: string;
      header: string[];
      rows: string[][];
      align: TableAlign[];
    };

/** Per-column alignment from the separator row; null when it says nothing. */
export type TableAlign = "left" | "center" | "right" | null;

/** How a diff line is tinted. `meta` covers hunk headers and file headers. */
export type DiffLineKind = "add" | "del" | "meta" | "context";

const FENCE = /^(\s*)(`{3,}|~{3,})(.*)$/;

/**
 * Tags worth naming above the block. Anything else still renders as code, just
 * without a label — an unknown tag is more likely noise than a language.
 */
const LANGUAGE_LABELS: Record<string, string> = {
  bash: "bash",
  c: "c",
  console: "console",
  cpp: "c++",
  css: "css",
  diff: "diff",
  go: "go",
  html: "html",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "jsx",
  kotlin: "kotlin",
  markdown: "markdown",
  md: "markdown",
  patch: "diff",
  php: "php",
  py: "python",
  python: "python",
  rb: "ruby",
  ruby: "ruby",
  rs: "rust",
  rust: "rust",
  sh: "shell",
  shell: "shell",
  sql: "sql",
  swift: "swift",
  text: "text",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

const DIFF_TAGS = new Set(["diff", "patch"]);

const META_PREFIXES = [
  "diff --git",
  "index ",
  "new file mode",
  "deleted file mode",
  "old mode",
  "new mode",
  "similarity index",
  "rename from",
  "rename to",
  "Binary files",
];

/** Which tint a line of a diff body gets. */
export function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("@@")) return "meta";
  if (line.startsWith("---") || line.startsWith("+++")) return "meta";
  for (const prefix of META_PREFIXES) {
    if (line.startsWith(prefix)) return "meta";
  }
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "context";
}

/**
 * Whether unfenced text is a diff. A `diff --git` or `@@ -a,b +c,d @@` header
 * settles it; otherwise a run of change lines has to carry both an addition and
 * a removal, so a markdown bullet list is not mistaken for one.
 */
export function looksLikeDiff(text: string): boolean {
  if (text.includes("diff --git ")) return true;
  if (/^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m.test(text)) return true;

  let run = 0;
  let adds = 0;
  let dels = 0;
  for (const line of text.split("\n")) {
    const kind = diffLineKind(line);
    if (kind === "add" || kind === "del") {
      run += 1;
      if (kind === "add") adds += 1;
      else dels += 1;
      if (run >= 3 && adds > 0 && dels > 0) return true;
    } else {
      run = 0;
      adds = 0;
      dels = 0;
    }
  }
  return false;
}

function codeBlock(tag: string, text: string): ToolOutputBlock {
  const lang = tag.toLowerCase();
  if (DIFF_TAGS.has(lang)) return { kind: "diff", text };
  return { kind: "code", label: LANGUAGE_LABELS[lang] ?? null, lang: lang || null, text };
}

/**
 * A table's cells: split on unescaped pipes, then trim. A leading or trailing
 * pipe (the usual markdown shape) leaves empty edge cells that are dropped;
 * `\|` is a literal pipe inside a cell.
 */
function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\\" && line[i + 1] === "|") {
      current += "|";
      i += 1;
      continue;
    }
    if (char === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);

  if (cells.length > 1 && cells[0].trim() === "") cells.shift();
  if (cells.length > 1 && cells[cells.length - 1].trim() === "") cells.pop();
  return cells.map((cell) => cell.trim());
}

/** A `|---|:--:|` row: only dashes, colons and pipes, with at least one dash. */
function isSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("-") || !trimmed.includes("|")) return false;
  return /^\|?[\s:|-]+\|?$/.test(trimmed) && /-/.test(trimmed);
}

function separatorAlign(line: string): TableAlign[] {
  return splitRow(line).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (right) return "right";
    if (left) return "left";
    return null;
  });
}

/**
 * Whether `lines[index]` starts a markdown table: a header row with a pipe, a
 * separator row under it, and at least one body row. The separator is what
 * keeps a command's `ps | grep` line from being read as a table.
 */
function tableAt(lines: string[], index: number): Extract<ToolOutputBlock, { kind: "table" }> | null {
  const header = lines[index];
  const separator = lines[index + 1];
  const firstBody = lines[index + 2];
  if (header === undefined || separator === undefined || firstBody === undefined) return null;
  if (!header.includes("|") || !isSeparatorRow(separator) || !firstBody.includes("|")) return null;

  const columns = splitRow(header);
  if (columns.length < 2) return null;
  const align = separatorAlign(separator);
  const rows: string[][] = [];
  let last = index + 1;
  for (let i = index + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "" || !line.includes("|")) break;
    const cells = splitRow(line);
    rows.push(columns.map((_, column) => cells[column] ?? ""));
    last = i;
  }
  return {
    align,
    header: columns,
    kind: "table",
    rows,
    text: lines.slice(index, last + 1).join("\n"),
  };
}

/**
 * One run of text as blocks: a markdown table becomes a table, everything
 * around it stays the plain text it was. Only tables are recognised — this is
 * terminal output, where `*`, `_` and `#` mean what the shell says they mean,
 * so the rest of markdown is deliberately not interpreted.
 */
function textBlocks(lines: string[]): ToolOutputBlock[] {
  const blocks: ToolOutputBlock[] = [];
  let pending: string[] = [];

  const flushText = () => {
    const text = pending.join("\n").replace(/^\n+|\n+$/g, "");
    pending = [];
    if (!text.trim()) return;
    blocks.push(looksLikeDiff(text) ? { kind: "diff", text } : { kind: "text", text });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const table = tableAt(lines, i);
    if (!table) {
      pending.push(lines[i]);
      continue;
    }
    flushText();
    blocks.push(table);
    i += 1 + table.rows.length;
  }
  flushText();
  return blocks;
}

/**
 * Split raw tool output into renderable blocks. Fences are consumed; an
 * unterminated fence keeps the rest of the output as its body, which is what
 * output truncated mid-block looks like.
 */
export function parseToolOutput(content: string): ToolOutputBlock[] {
  if (!content.includes("```") && !content.includes("~~~")) {
    return textBlocks(content.split("\n"));
  }

  const blocks: ToolOutputBlock[] = [];
  const pending: string[] = [];
  let fence: { marker: string; tag: string; body: string[] } | null = null;

  const flushText = () => {
    blocks.push(...textBlocks(pending));
    pending.length = 0;
  };

  for (const line of content.split("\n")) {
    const match = FENCE.exec(line);
    if (fence) {
      const closes =
        match !== null &&
        match[2][0] === fence.marker[0] &&
        match[2].length >= fence.marker.length &&
        match[3].trim() === "";
      if (closes) {
        blocks.push(codeBlock(fence.tag, fence.body.join("\n")));
        fence = null;
      } else {
        fence.body.push(line);
      }
      continue;
    }
    if (match) {
      flushText();
      fence = { body: [], marker: match[2], tag: match[3].trim().split(/\s+/)[0] ?? "" };
      continue;
    }
    pending.push(line);
  }

  if (fence) blocks.push(codeBlock(fence.tag, fence.body.join("\n")));
  else flushText();

  return blocks;
}
