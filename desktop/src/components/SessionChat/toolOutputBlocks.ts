/** One run of tool output: prose, a fenced code block, or a diff. */
export type ToolOutputBlock =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string | null; label: string | null; text: string }
  | { kind: "diff"; text: string };

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

function textBlock(lines: string[]): ToolOutputBlock | null {
  const text = lines.join("\n").replace(/^\n+|\n+$/g, "");
  if (!text.trim()) return null;
  return looksLikeDiff(text) ? { kind: "diff", text } : { kind: "text", text };
}

/**
 * Split raw tool output into renderable blocks. Fences are consumed; an
 * unterminated fence keeps the rest of the output as its body, which is what
 * output truncated mid-block looks like.
 */
export function parseToolOutput(content: string): ToolOutputBlock[] {
  if (!content.includes("```") && !content.includes("~~~")) {
    const only = textBlock(content.split("\n"));
    return only ? [only] : [];
  }

  const blocks: ToolOutputBlock[] = [];
  const pending: string[] = [];
  let fence: { marker: string; tag: string; body: string[] } | null = null;

  const flushText = () => {
    const block = textBlock(pending);
    pending.length = 0;
    if (block) blocks.push(block);
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
