import { Check, Copy } from "lucide-react";
import * as React from "react";

import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/utils";

/**
 * A small copy affordance: the clipboard write, the tick that says it worked,
 * and the toast that says it did not.
 *
 * Every copy in the app used to spell this out again and most of them forgot
 * the failure path — a WebView with no clipboard permission is exactly where
 * the user most needs to be told the copy did not happen.
 */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  /** What is being copied, for the tooltip, the ARIA name and the error. */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = React.useCallback(
    async (event: React.MouseEvent) => {
      // Rows and headings often carry their own click; copying is not that.
      event.stopPropagation();
      if (await copyText(value, label)) setCopied(true);
    },
    [label, value],
  );

  return (
    <button
      type="button"
      onClick={(event) => void copy(event)}
      aria-label={`Copy ${label.toLowerCase()}`}
      title={`Copy ${label.toLowerCase()}`}
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded text-muted-foreground/50",
        "transition-colors hover:bg-secondary hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        copied && "text-ok",
        className,
      )}
    >
      {copied ? (
        <Check aria-hidden className="size-3 text-ok" />
      ) : (
        <Copy aria-hidden className="size-3" />
      )}
    </button>
  );
}
