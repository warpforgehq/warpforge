import { ChevronRight, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { SessionUpdate } from "@/protocol";

type KeeperRequest = Extract<SessionUpdate, { kind: "keeper_request" }>;

/**
 * A fix prompt the task's keepers sent into the session: one attributed line
 * that expands to the prompt, so it never reads as the owner's message.
 * @param update The transcript entry.
 * @returns The line.
 */
export function KeeperRequestLine({ update }: { update: KeeperRequest }) {
  const [open, setOpen] = useState(false);
  return (
    <section
      aria-label="Keepers asked"
      className="my-2 min-w-0 rounded-md border border-border bg-secondary/20 px-3 py-1.5 text-muted-foreground"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full min-w-0 items-center gap-2 text-left text-[13px]"
      >
        <ShieldCheck aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="shrink-0 font-semibold text-foreground">Keepers asked for a fix</span>
        {!open && <span className="min-w-0 truncate">{update.text.split("\n")[0]}</span>}
        <ChevronRight
          aria-hidden
          className={cn("ml-auto size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <p className="mt-1.5 text-sm whitespace-pre-wrap break-words text-foreground">
          {update.text}
        </p>
      )}
    </section>
  );
}
