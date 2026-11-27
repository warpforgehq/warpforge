import { type Document, isCollection, isNode, isScalar, parseDocument } from "yaml";

import type { ProjectConfigScope } from "@/protocol";

export type ConfigPath = readonly (string | number)[];

/** One form change: set or delete the node at `path` in one file. */
export interface ConfigOp {
  scope: ProjectConfigScope;
  path: ConfigPath;
  value?: unknown;
  remove?: boolean;
  /** The value at `path` just before this op, in the doc it was applied to. */
  base: unknown;
}

/** An op whose path changed on disk to something other than the op's own result. */
export interface ConfigConflict {
  op: ConfigOp;
  disk: unknown;
}

export type ConfigTexts = Record<ProjectConfigScope, string>;
export type ConfigDocs = Record<ProjectConfigScope, Document>;

export const SCOPES: readonly ProjectConfigScope[] = ["shared", "local"];

/**
 * Parse both files into editable documents.
 * @param texts raw text of the shared and local files
 * @returns a document per scope
 */
export function parseDocs(texts: ConfigTexts): ConfigDocs {
  return { local: parseDocument(texts.local), shared: parseDocument(texts.shared) };
}

/**
 * The plain value at a path, or undefined when absent.
 * @param doc the document
 * @param path key path
 * @returns the value as JSON-like data
 */
export function valueAt(doc: Document, path: ConfigPath): unknown {
  if (!doc.hasIn(path)) return undefined;
  const node = doc.getIn(path, true);
  return isNode(node) ? node.toJSON() : node;
}

/**
 * Deep equality for JSON-like data.
 * @param a first value
 * @param b second value
 * @returns whether both hold the same data
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => key in right && sameValue(left[key], right[key]));
}

function setValue(doc: Document, path: ConfigPath, value: unknown) {
  for (let depth = 1; depth < path.length; depth++) {
    const prefix = path.slice(0, depth);
    if (!doc.hasIn(prefix)) break;
    const node = doc.getIn(prefix, true);
    if (isCollection(node)) continue;
    if (isScalar(node) && node.value == null) {
      doc.setIn(prefix, doc.createNode(typeof path[depth] === "number" ? [] : {}));
    }
    break;
  }
  doc.setIn(path, value);
}

function deleteValue(doc: Document, path: ConfigPath) {
  if (!doc.hasIn(path)) return;
  doc.deleteIn(path);
  for (let depth = path.length - 1; depth > 0; depth--) {
    const prefix = path.slice(0, depth);
    const node = doc.getIn(prefix, true);
    if (!isCollection(node) || node.items.length > 0) return;
    doc.deleteIn(prefix);
  }
}

function apply(docs: ConfigDocs, op: ConfigOp) {
  if (op.remove) deleteValue(docs[op.scope], op.path);
  else setValue(docs[op.scope], op.path, op.value);
}

function result(op: Pick<ConfigOp, "remove" | "value">): unknown {
  return op.remove ? undefined : op.value;
}

function isUnder(path: ConfigPath, prefix: ConfigPath): boolean {
  return prefix.length <= path.length && prefix.every((key, index) => path[index] === key);
}

/**
 * Apply ops, in order, to fresh documents parsed from `texts`.
 * @param texts the files the ops were recorded against
 * @param ops pending ops
 * @returns the edited documents
 */
export function applyOps(texts: ConfigTexts, ops: readonly ConfigOp[]): ConfigDocs {
  const docs = parseDocs(texts);
  for (const op of ops) apply(docs, op);
  return docs;
}

/**
 * Add a change to the pending list. It replaces earlier ops at or below its
 * path, and drops out entirely when it restores the value already there.
 * @param texts the files on disk
 * @param ops pending ops
 * @param next the change
 * @returns the next pending list
 */
export function recordOp(
  texts: ConfigTexts,
  ops: readonly ConfigOp[],
  next: Omit<ConfigOp, "base">,
): ConfigOp[] {
  const remaining = ops.filter((op) => op.scope !== next.scope || !isUnder(op.path, next.path));
  const base = valueAt(applyOps(texts, remaining)[next.scope], next.path);
  if (sameValue(base, result(next))) return remaining;
  return [...remaining, { ...next, base }];
}

/**
 * Re-apply pending ops to files that changed on disk.
 * @param texts the fresh files
 * @param ops pending ops recorded against the old files
 * @returns ops that still apply, and conflicts where the disk and the form disagree
 */
export function replayOps(
  texts: ConfigTexts,
  ops: readonly ConfigOp[],
): { ops: ConfigOp[]; conflicts: ConfigConflict[] } {
  const docs = parseDocs(texts);
  const kept: ConfigOp[] = [];
  const conflicts: ConfigConflict[] = [];
  for (const op of ops) {
    const disk = valueAt(docs[op.scope], op.path);
    if (sameValue(disk, op.base)) {
      apply(docs, op);
      kept.push(op);
    } else if (!sameValue(disk, result(op))) {
      conflicts.push({ disk, op });
    }
  }
  return { conflicts, ops: kept };
}

/**
 * The scopes with pending changes, shared first.
 * @param ops pending ops
 * @returns scopes to save, in save order
 */
export function touchedScopes(ops: readonly ConfigOp[]): ProjectConfigScope[] {
  return SCOPES.filter((scope) => ops.some((op) => op.scope === scope));
}
