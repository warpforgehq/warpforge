import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { highlightCode, tagHighlighter, tags as t } from "@lezer/highlight";

import { codemirrorLanguageForPath } from "./codemirrorLanguages";
import type { PatchFileBlock, PatchLine } from "./pullDiff";

/**
 * Syntax colouring for a pull request's patch.
 *
 * A patch is not a document: the daemon sends the diff text only, and the
 * inbox deliberately never fetches both sides of every file (ADR-0010). So
 * each side of the patch is reassembled into one synthetic document, parsed
 * once with the file's CodeMirror grammar, and the resulting tokens are
 * handed back per patch line. Deleted lines colour from the old side, kept
 * and added lines from the new one.
 *
 * Colouring is decoration. Anything that fails, times out or grows past the
 * budget returns no tokens, and the diff still renders in full — plain.
 */
export interface SyntaxToken {
  text: string;
  /** A `wf-tok-*` class, themed from `--syntax-*` in globals.css. */
  className?: string;
}

/** Big enough for real review, small enough that a vendored bundle in a PR
 *  cannot stall the pane parsing text nobody reads. */
const MAX_HIGHLIGHT_CHARS = 250_000;
const SYNTAX_TREE_BUDGET_MS = 100;

/** The same tags the editor colours (`lib/codemirrorSyntax`), as classes. */
const HIGHLIGHTER = tagHighlighter([
  { tag: t.comment, class: "wf-tok-comment" },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.self], class: "wf-tok-keyword" },
  {
    tag: [t.string, t.special(t.string), t.character, t.regexp, t.labelName, t.literal],
    class: "wf-tok-string",
  },
  { tag: [t.number, t.integer, t.float, t.bool, t.atom, t.null], class: "wf-tok-const" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName)],
    class: "wf-tok-function",
  },
  { tag: [t.typeName, t.className, t.namespace], class: "wf-tok-type" },
  {
    tag: [
      t.variableName,
      t.propertyName,
      t.definition(t.variableName),
      t.definition(t.propertyName),
    ],
    class: "wf-tok-variable",
  },
  { tag: [t.operator, t.definitionOperator], class: "wf-tok-operator" },
  { tag: [t.punctuation, t.separator, t.bracket], class: "wf-tok-punctuation" },
  { tag: [t.tagName, t.meta, t.processingInstruction], class: "wf-tok-tag" },
  { tag: [t.attributeName], class: "wf-tok-attribute" },
]);

/** Tokens per `PatchLine.id`. A missing id means "render that line plain". */
export type PatchHighlight = Map<string, SyntaxToken[]>;

/**
 * One file at a time, and never on the frame that asked for it. Parsing is
 * synchronous CodeMirror work; several files starting together blocked the main
 * thread long enough that the diff stopped answering hover.
 */
let queue: Promise<unknown> = Promise.resolve();

export function highlightPatchBlock(block: PatchFileBlock): Promise<PatchHighlight> {
  const run = queue.then(() => idle()).then(() => highlightNow(block));
  queue = run.catch(() => undefined);
  return run;
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(() => resolve(), {
        timeout: 150,
      });
    else setTimeout(resolve, 0);
  });
}

async function highlightNow(block: PatchFileBlock): Promise<PatchHighlight> {
  const tokens: PatchHighlight = new Map();
  if (block.binary) return tokens;

  const oldSide: PatchLine[] = [];
  const newSide: PatchLine[] = [];
  let chars = 0;
  for (const hunk of block.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "meta") continue;
      if (line.kind !== "add") oldSide.push(line);
      if (line.kind !== "del") newSide.push(line);
      chars += line.text.length + 1;
      if (chars > MAX_HIGHLIGHT_CHARS) return tokens;
    }
  }
  if (oldSide.length === 0 && newSide.length === 0) return tokens;

  const language = await codemirrorLanguageForPath(block.path);
  if (language.length === 0) return tokens;

  assign(tokens, oldSide, parseLines(oldSide, language), (line) => line.kind === "del");
  assign(tokens, newSide, parseLines(newSide, language), (line) => line.kind !== "del");
  return tokens;
}

/** One synthetic document per side, tokenised line by line. */
function parseLines(lines: readonly PatchLine[], language: Extension[]): SyntaxToken[][] {
  const doc = lines.map((line) => line.text).join("\n");
  if (!doc) return [];
  const state = EditorState.create({ doc, extensions: language });
  const tree =
    ensureSyntaxTree(state, state.doc.length, SYNTAX_TREE_BUDGET_MS) ?? syntaxTree(state);
  const out: SyntaxToken[][] = [[]];
  highlightCode(
    state.doc.toString(),
    tree,
    HIGHLIGHTER,
    (piece, className) => {
      if (!piece) return;
      const line = out[out.length - 1];
      if (!line) return;
      // One span per run of a class, not per token: adjacent punctuation,
      // operators and plain text usually carry the same class, and a span each
      // is what put 27 DOM elements on a single coloured row.
      const last = line[line.length - 1];
      if (last && last.className === className) last.text += piece;
      else line.push(className ? { text: piece, className } : { text: piece });
    },
    () => {
      out.push([]);
    },
  );
  return out;
}

function assign(
  tokens: PatchHighlight,
  lines: readonly PatchLine[],
  parsed: readonly SyntaxToken[][],
  take: (line: PatchLine) => boolean,
) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line || !take(line)) continue;
    const pieces = parsed[index];
    // A grammar that resynchronised mid-file would shift every line after it.
    // Only tokens that still spell the line are trusted.
    if (pieces && pieces.map((piece) => piece.text).join("") === line.text) {
      tokens.set(line.id, pieces);
    }
  }
}
