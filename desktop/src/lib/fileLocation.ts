export interface FileLocation {
  path: string;
  line?: number;
  column?: number;
  endLine?: number;
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const HASH_RANGE = /^(.*)#L(\d+)(?:-L?(\d+))?$/i;
const COLON_COLUMN = /^(.*):(\d+):(\d+)$/;
const COLON_RANGE = /^(.*):(\d+)[-–](\d+)$/;
const COLON_LINE = /^(.*):(\d+)$/;

function withRange(path: string, line: number, endLine?: number): FileLocation | null {
  if (!path || line < 1) return null;
  if (endLine !== undefined) {
    return endLine >= line ? { endLine, line, path } : null;
  }
  return { line, path };
}

/**
 * Splits an optional `line`, `line:column` or line range off a file reference.
 *
 * Supported suffixes: `:53`, `:53:12`, `:53-60`, `:53–60`, `#L53`,
 * `#L53-L60` and `#L53-60`. A suffix is stripped only when the rest looks like
 * a path, so a drive letter (`C:\src`) or a URL (`http://host:3000`) is left
 * alone. Anything else is returned unchanged.
 */
export function parseFileLocation(text: string): FileLocation {
  const value = text.trim();
  if (!value || URL_SCHEME.test(value)) {
    return { path: value };
  }

  const hash = HASH_RANGE.exec(value);
  if (hash) {
    const location = withRange(
      hash[1],
      Number(hash[2]),
      hash[3] === undefined ? undefined : Number(hash[3]),
    );
    if (location) return location;
  }

  const column = COLON_COLUMN.exec(value);
  if (column) {
    const line = Number(column[2]);
    if (column[1] && line >= 1) {
      return { column: Number(column[3]), line, path: column[1] };
    }
  }

  const range = COLON_RANGE.exec(value);
  if (range) {
    const location = withRange(range[1], Number(range[2]), Number(range[3]));
    if (location) return location;
  }

  const single = COLON_LINE.exec(value);
  if (single) {
    const location = withRange(single[1], Number(single[2]));
    if (location) return location;
  }

  return { path: value };
}
