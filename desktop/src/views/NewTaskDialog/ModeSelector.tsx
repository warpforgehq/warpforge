import { cn } from "@/lib/utils";

import type { TaskMode } from "../../components/TaskComposeBar";

const MODES: { id: TaskMode; label: string }[] = [
  { id: "single", label: "Single agent" },
  { id: "orchestrator", label: "Orchestrator" },
  { id: "factory", label: "Factory" },
];

export function ModeSelector({
  chat = false,
  factoryOnly = false,
  hasValidWorkflows,
  mode,
  onChange,
}: {
  /** A chat without a project runs a single agent. */
  chat?: boolean;
  /** Several backlog items only start in Factory. */
  factoryOnly?: boolean;
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
        const disabled = chat
          ? id !== "single"
          : id === "factory"
            ? !hasValidWorkflows
            : factoryOnly;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            disabled={disabled}
            title={
              !disabled
                ? undefined
                : chat
                  ? "Without a project, only a single agent runs"
                  : id === "factory"
                    ? "This project has no valid workflow templates"
                    : "Several backlog items start in Factory"
            }
            onClick={() => onChange(id)}
            className={cn(
              "h-7 shrink-0 rounded-md px-3 text-[13px] transition-colors",
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
