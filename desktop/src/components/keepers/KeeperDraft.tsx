import { useState } from "react";

import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

/**
 * A draft keeper's text: a few lines until expanded, with Copy. Neutral
 * styling, because a draft is neither a pass nor a failure.
 * @param name The keeper's display name.
 * @param text The draft.
 * @returns The draft block.
 */
export function KeeperDraft({ name, text }: { name: string; text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.split("\n").length > 4 || text.length > 320;
  return (
    <section
      aria-label={`${name} draft`}
      className="flex flex-col gap-1 rounded-md border border-border bg-muted/40 px-2.5 py-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">Draft</span>
        <CopyButton value={text} label="Draft" />
      </div>
      <p
        className={cn(
          "font-mono text-xs whitespace-pre-wrap break-words text-foreground",
          !open && "line-clamp-4",
        )}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          className="self-start text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </section>
  );
}
