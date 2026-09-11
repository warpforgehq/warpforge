import { cn } from "@/lib/utils";

import type { TaskMode } from "../../components/TaskComposeBar";

const MODES: { id: TaskMode; label: string }[] = [
  { id: "single", label: "Single agent" },
  { id: "orchestrator", label: "Orchestrator" },
  { id: "workflow", label: "Workflow" },
];

export function ModeSelector({
  hasValidWorkflows,
  mode,
  onChange,
}: {
  hasValidWorkflows: boolean;
  mode: TaskMode;
  onChange: (next: TaskMode) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Execution mode"
      className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg bg-card p-0.5"
    >
      {MODES.map(({ id, label }) => {
        const disabled = id === "workflow" && !hasValidWorkflows;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            disabled={disabled}
            title={disabled ? "This project has no valid workflows" : undefined}
            onClick={() => onChange(id)}
            className={cn(
              "h-7 shrink-0 rounded-md px-3 text-xs transition-colors",
              mode === id
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:text-foreground",
              disabled && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
