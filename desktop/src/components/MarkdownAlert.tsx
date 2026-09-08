import { Info, Lightbulb, OctagonAlert, TriangleAlert } from "lucide-react";
import { Children, cloneElement, isValidElement } from "react";

import { cn } from "@/lib/utils";

/**
 * GitHub's alert blockquotes (`> [!IMPORTANT]`), which review bots write
 * constantly and neither remark-gfm nor GitHub's own syntax turns into
 * markup — the kind rides in the first line's text.
 *
 * Reading it off the rendered children rather than adding a remark plugin
 * keeps it out of the pipeline: a second AST pass on every message the app
 * renders is a lot to pay for five keywords.
 */
const ALERT_KINDS = {
  caution: {
    icon: OctagonAlert,
    label: "Caution",
    tone: { frame: "border-destructive/60 bg-destructive/5", label: "text-destructive" },
  },
  important: {
    icon: Info,
    label: "Important",
    tone: { frame: "border-primary/60 bg-primary/5", label: "text-primary" },
  },
  note: {
    icon: Info,
    label: "Note",
    tone: { frame: "border-border bg-secondary/30", label: "text-foreground/80" },
  },
  tip: {
    icon: Lightbulb,
    label: "Tip",
    tone: { frame: "border-ok/60 bg-ok/5", label: "text-ok" },
  },
  warning: {
    icon: TriangleAlert,
    label: "Warning",
    tone: { frame: "border-warn/60 bg-warn/5", label: "text-warn" },
  },
} as const;

type AlertKind = keyof typeof ALERT_KINDS;

const ALERT_MARKER = /^\[!(note|tip|important|warning|caution)]\s*/i;

/** The alert kind and the quote with its marker removed, or null when this is
 *  an ordinary blockquote. */
export function splitMarkdownAlert(
  content: React.ReactNode,
): { body: React.ReactNode; kind: AlertKind } | null {
  const nodes = Children.toArray(content);
  const first = nodes.find((node) => isValidElement(node));
  if (!isValidElement<{ children?: React.ReactNode }>(first)) return null;
  const head = Children.toArray(first.props.children);
  const lead = head[0];
  const marker = typeof lead === "string" ? ALERT_MARKER.exec(lead) : null;
  if (!marker || typeof lead !== "string") return null;
  const rest = lead.slice(marker[0].length);
  const trimmed = rest ? [rest, ...head.slice(1)] : head.slice(1);
  return {
    body: nodes.map((node) => (node === first ? cloneElement(first, { children: trimmed }) : node)),
    kind: marker[1].toLowerCase() as AlertKind,
  };
}

/** One alert as a labelled callout: the marker becomes a heading with a glyph,
 *  because the raw `[!IMPORTANT]` line reads as markup that failed to render. */
export function MarkdownAlert({
  kind,
  children,
}: {
  kind: AlertKind;
  children: React.ReactNode;
}) {
  const { icon: Icon, label, tone } = ALERT_KINDS[kind];
  return (
    <div className={cn("my-2 rounded-md border-l-2 py-1.5 pl-3", tone.frame)}>
      <p className={cn("flex items-center gap-1.5 text-xs font-medium", tone.label)}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {label}
      </p>
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}
