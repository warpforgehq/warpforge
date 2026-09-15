import { Check, Copy } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

/** A fenced code block's `<pre><code>`, with a copy button revealed on hover/focus. */
export function MarkdownCodeBlock({ text, children }: { text: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.error("Could not copy code");
    }
  };

  return (
    <div className="group/code relative my-2">
      <pre className="max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-2.5 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
        {children}
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-2 top-2 rounded-md border border-border/80 bg-background/95 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-secondary hover:text-foreground group-hover/code:opacity-100 group-focus-within/code:opacity-100"
        aria-label="Copy code"
        title="Copy code"
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
