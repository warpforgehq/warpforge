import type { MentionCandidate } from "./peerFeed";

/** Mirrors `src/daemon/actor/peers/mention.rs`; both run
 *  `tests/fixtures/mention-vectors.json`. */
const MIN_ID_PREFIX = 4;
const WORD = /[\p{Alphabetic}\p{N}_]/u;

/**
 * @param char one character
 * @returns whether it continues a word, as the daemon counts it
 */
export function isWordChar(char: string): boolean {
  return WORD.test(char);
}

/**
 * @param previous the character before an `@`, or undefined at the start
 * @returns whether an `@` there starts a mention
 */
export function startsMention(previous: string | undefined): boolean {
  return previous === undefined || (!isWordChar(previous) && previous !== "@");
}

function labelMatch(rest: string[], label: string): number | null {
  const chars = Array.from(label);
  if (chars.length === 0 || rest.length < chars.length) return null;
  for (let i = 0; i < chars.length; i++) {
    if (rest[i]!.toLowerCase() !== chars[i]!.toLowerCase()) return null;
  }
  const next = rest[chars.length];
  return next !== undefined && isWordChar(next) ? null : chars.length;
}

function idMatch(rest: string[], id: string): number | null {
  const token: string[] = [];
  for (const char of rest) {
    if (!isWordChar(char)) break;
    token.push(char);
  }
  const lower = token.join("").toLowerCase();
  const hex = id.startsWith("t_") ? id.slice(2) : id;
  const prefix = lower.startsWith("t_") ? lower.slice(2) : lower;
  return Array.from(prefix).length >= MIN_ID_PREFIX && hex.startsWith(prefix) ? token.length : null;
}

/** What the daemon will make of a post's mentions. */
export interface MentionResolution {
  /** The sessions it reaches, in order of first mention. */
  found: string[];
  /** A mention two sessions match: the daemon refuses the post. */
  ambiguous: { mention: string; ids: string[] } | null;
  /** `@words` that match no session; the daemon posts them as text. */
  unmatched: string[];
}

/** One `@` that starts a mention, and what it matched. */
interface Scanned {
  /** Index of the `@`, in characters. */
  at: number;
  /** Characters after the `@` that the match covers. */
  length: number;
  matched: MentionCandidate[];
  /** The `@word` when nothing matched. */
  word: string;
}

function scan(text: string, candidates: MentionCandidate[]): Scanned[] {
  const chars = Array.from(text);
  const scanned: Scanned[] = [];
  for (let at = 0; at < chars.length; at++) {
    if (chars[at] !== "@" || !startsMention(chars[at - 1])) continue;
    const rest = chars.slice(at + 1);
    let best = 0;
    let matched: MentionCandidate[] = [];
    for (const candidate of candidates) {
      const len = Math.max(
        labelMatch(rest, candidate.label) ?? 0,
        idMatch(rest, candidate.id) ?? 0,
      );
      if (len === 0) continue;
      if (len > best) {
        best = len;
        matched = [candidate];
      } else if (len === best && !matched.some((m) => m.id === candidate.id)) {
        matched.push(candidate);
      }
    }
    const word: string[] = [];
    for (const char of rest) {
      if (!isWordChar(char)) break;
      word.push(char);
    }
    scanned.push({ at, length: best, matched, word: word.join("") });
  }
  return scanned;
}

/**
 * @param text the post
 * @param candidates the sessions a mention may name
 * @returns the sessions it mentions, the first ambiguous mention, and the
 *   `@words` that name nobody
 */
export function resolveMentions(text: string, candidates: MentionCandidate[]): MentionResolution {
  const chars = Array.from(text);
  const found: string[] = [];
  const unmatched: string[] = [];
  for (const { at, length, matched, word } of scan(text, candidates)) {
    if (matched.length > 1) {
      return {
        ambiguous: {
          ids: matched.map((m) => m.id),
          mention: chars.slice(at + 1, at + 1 + length).join(""),
        },
        found,
        unmatched,
      };
    }
    if (matched.length === 1) {
      if (!found.includes(matched[0]!.id)) found.push(matched[0]!.id);
      continue;
    }
    if (word.length > 0) unmatched.push(`@${word}`);
  }
  return { ambiguous: null, found, unmatched };
}

/** A resolved mention inside a text. */
export interface MentionSpan {
  /** Where the `@` is, in characters. */
  start: number;
  /** Just past the mention, in characters. */
  end: number;
  candidate: MentionCandidate;
}

/**
 * The mentions in `text` that name exactly one candidate, for highlighting;
 * ambiguous and unmatched `@words` are left out.
 * @param text the text
 * @param candidates the sessions a mention may name
 * @returns the spans, in order
 */
export function mentionSpans(text: string, candidates: MentionCandidate[]): MentionSpan[] {
  return scan(text, candidates)
    .filter((s) => s.matched.length === 1)
    .map((s) => ({ candidate: s.matched[0]!, end: s.at + 1 + s.length, start: s.at }));
}
