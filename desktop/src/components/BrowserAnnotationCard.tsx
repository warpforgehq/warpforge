import { MousePointerClick } from "lucide-react";

const ZERO_WIDTH = String.fromCharCode(0x200b);
const BLOCK = /<browser_annotation>([\s\S]*?)<\/browser_annotation>/g;

export interface ParsedAnnotation {
  url?: string;
  selector?: string;
  role?: string;
  href?: string;
  text?: string;
}

export type MessagePart =
  | { kind: "text"; value: string }
  | { kind: "annotation"; value: ParsedAnnotation };

function clean(value: string): string {
  return value.split(ZERO_WIDTH).join("").trim();
}

/** Pull the fields out of one `<browser_annotation>` body. `text` is last in
 *  the block and may span lines, so it captures everything after its marker. */
function parse(body: string): ParsedAnnotation {
  const out: ParsedAnnotation = {};
  const single = (key: keyof ParsedAnnotation, label: string) => {
    const m = body.match(new RegExp(`^${label}: (.*)$`, "m"));
    if (m) out[key] = clean(m[1]);
  };
  single("url", "url");
  single("selector", "selector");
  single("role", "role");
  single("href", "href");
  const text = body.indexOf("\ntext: ");
  if (text !== -1) out.text = clean(body.slice(text + "\ntext: ".length));
  return out;
}

/** Split a message into plain text and annotation cards, preserving order. */
export function splitAnnotations(text: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let last = 0;
  for (const match of text.matchAll(BLOCK)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ kind: "text", value: text.slice(last, start) });
    parts.push({ kind: "annotation", value: parse(match[1]) });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

export function hasAnnotation(text: string): boolean {
  return /<browser_annotation>/.test(text);
}

export function BrowserAnnotationCard({ annotation }: { annotation: ParsedAnnotation }) {
  let host: string | null = null;
  try {
    if (annotation.url) host = new URL(annotation.url).host;
  } catch {
    host = null;
  }
  return (
    <div className="my-2 rounded-md border bg-secondary/40 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
        <MousePointerClick className="size-3.5 text-info" />
        <span>Pointed at {annotation.role ?? "an element"} in the browser</span>
        {host && <span className="truncate">· {host}</span>}
      </div>
      {annotation.text && (
        <p className="line-clamp-4 whitespace-pre-wrap break-words leading-relaxed text-foreground">
          {annotation.text}
        </p>
      )}
      {annotation.selector && (
        <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground" title={annotation.selector}>
          {annotation.selector}
        </p>
      )}
    </div>
  );
}
