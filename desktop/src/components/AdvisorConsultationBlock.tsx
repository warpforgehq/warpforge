import { ChevronRight } from "lucide-react";
import { useId, useState } from "react";

import { advisorLabel, formatUsageCost } from "@/lib/advisor";
import { agentDisplayName } from "@/lib/agentNames";
import { cn } from "@/lib/utils";
import type { SessionUpdate } from "@/protocol";

import { AgentLogo } from "./AgentLogo";
import { Markdown } from "./Markdown";

type AdvisorConsultation = Extract<SessionUpdate, { kind: "advisor_consultation" }>;

/**
 * One question the task's agent put to its advisor, folded to a header row.
 * @param update the recorded consultation
 * @param onOpenTask opens the advisor's hidden task
 * @returns the consultation block
 */
export function AdvisorConsultationBlock({
  update,
  onOpenTask,
}: {
  update: AdvisorConsultation;
  onOpenTask?: (id: string) => void;
}) {
  const contentId = useId();
  const [open, setOpen] = useState(false);
  const failed = update.outcome === "failed";
  const label = advisorLabel(update.agent, update.model);
  const cost = update.cost ? formatUsageCost(update.cost) : null;

  return (
    <section
      aria-label="Advisor consultation"
      className={cn(
        "min-w-0 overflow-hidden rounded-md border bg-secondary/30",
        failed && "border-destructive/35 bg-destructive/[0.06]",
      )}
    >
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-secondary/50"
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
        <AgentLogo
          agentId={update.agent}
          displayName={agentDisplayName(update.agent)}
          className="size-3.5 shrink-0"
        />
        <span className="min-w-0 flex-1 truncate font-medium" title={label}>
          Asked advisor · {label}
        </span>
        {cost && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{cost}</span>
        )}
        {failed && <span className="shrink-0 text-[11px] text-destructive">failed</span>}
      </button>
      {open && (
        <div id={contentId} className="space-y-2 border-t px-2.5 py-2">
          <div>
            <div className="mb-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              Question
            </div>
            <Markdown>{update.question}</Markdown>
          </div>
          <div>
            <div
              className={cn(
                "mb-0.5 text-[11px] uppercase tracking-wider",
                failed ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {failed ? "No answer" : "Answer"}
            </div>
            <Markdown>{update.answer}</Markdown>
          </div>
          {onOpenTask && (
            <button
              type="button"
              onClick={() => onOpenTask(update.advisor_task_id)}
              className="text-[11px] text-primary hover:underline"
            >
              Open advisor conversation
            </button>
          )}
        </div>
      )}
    </section>
  );
}
