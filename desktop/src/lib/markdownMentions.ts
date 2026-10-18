import type { MentionCandidate } from "./peerFeed";
import { mentionSpans } from "./peerMentions";

/** The part of an mdast node this plugin reads and writes. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** How one resolved mention is drawn. */
export interface MentionLook {
  className: string;
  /** An inline CSS declaration list. */
  style?: string;
}

/** Links keep their own styling; code spans and blocks are not `text` nodes. */
const SKIP = new Set(["link", "linkReference"]);

function split(node: MdNode, candidates: MentionCandidate[], look: Look): MdNode[] {
  const chars = Array.from(node.value ?? "");
  const spans = mentionSpans(node.value ?? "", candidates);
  if (spans.length === 0) return [node];
  const out: MdNode[] = [];
  let from = 0;
  for (const span of spans) {
    if (span.start > from)
      out.push({ type: "text", value: chars.slice(from, span.start).join("") });
    const { className, style } = look(span.candidate);
    out.push({
      children: [{ type: "text", value: chars.slice(span.start, span.end).join("") }],
      data: {
        hName: "span",
        hProperties: { className: [className], dataMention: span.candidate.id, style },
      },
      type: "mention",
    });
    from = span.end;
  }
  if (from < chars.length) out.push({ type: "text", value: chars.slice(from).join("") });
  return out;
}

type Look = (candidate: MentionCandidate) => MentionLook;

function walk(node: MdNode, candidates: MentionCandidate[], look: Look) {
  if (!node.children || SKIP.has(node.type)) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text") return split(child, candidates, look);
    walk(child, candidates, look);
    return [child];
  });
}

/**
 * A remark plugin that wraps each `@mention` naming exactly one candidate in
 * a span, by the composer's and daemon's rules. Text in code is never touched.
 * @param candidates the sessions a mention may name
 * @param look how a mention of a candidate is drawn
 * @returns the plugin
 */
export function remarkMentions(candidates: MentionCandidate[], look: Look) {
  return () => (tree: MdNode) => walk(tree, candidates, look);
}
