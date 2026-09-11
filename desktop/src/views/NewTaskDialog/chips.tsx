import { Check, ChevronDown, Folder, GitBranch } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { agentDisplayName } from "@/lib/agentNames";
import { cn } from "@/lib/utils";

import { AgentLogo } from "../../components/AgentLogo";
import type { AgentConfig, Snapshot } from "../../protocol";

/** Deliberately the same shape and weight as `AgentConfigBar`'s selectors —
 *  these sit in the same toolbar row, so anything heavier makes the project and
 *  harness pickers read as a different kind of control than the model picker. */
const CHIP =
  "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground";
const CHIP_ACTIVE = "bg-secondary text-foreground";

export function ChipDivider() {
  return <span aria-hidden className="mx-0.5 h-3.5 w-px shrink-0 bg-border" />;
}

export function ProjectChip({
  onChange,
  project,
  projects,
  title,
}: {
  onChange: (next: string) => void;
  project: string;
  projects: Snapshot["projects"];
  title: string;
}) {
  if (projects.length === 0) {
    return <span className="px-1.5">No projects added.</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Project" title={title} className={CHIP}>
          <Folder aria-hidden className="size-3 shrink-0" />
          <span className="max-w-32 truncate">{project}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {projects.map((candidate) => (
          <DropdownMenuItem
            key={candidate.name}
            className="text-xs"
            onSelect={() => onChange(candidate.name)}
          >
            <Check
              aria-hidden
              className={cn("size-3.5 shrink-0", project === candidate.name ? "" : "opacity-0")}
            />
            <span className="truncate">{candidate.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function HarnessChip({
  agent,
  agents,
  onChange,
  title,
}: {
  agent: string;
  agents: AgentConfig[];
  onChange: (next: string) => void;
  title: string;
}) {
  const current = agents.find((candidate) => candidate.id === agent);
  const currentName = agentDisplayName(agent, current?.displayName);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Harness" title={title} className={CHIP}>
          <AgentLogo agentId={agent} displayName={currentName} className="size-3.5 shrink-0" />
          <span className="max-w-32 truncate">{currentName}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {agents.map((candidate) => {
          const name = agentDisplayName(candidate.id, candidate.displayName);
          return (
            <DropdownMenuItem
              key={candidate.id}
              className="text-xs"
              onSelect={() => onChange(candidate.id)}
            >
              <AgentLogo agentId={candidate.id} displayName={name} className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">{name}</span>
              {agent === candidate.id && <Check aria-hidden className="size-3.5 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ToggleChip({
  active,
  disabled = false,
  icon: Icon,
  label,
  onClick,
  title,
}: {
  active: boolean;
  disabled?: boolean;
  icon: typeof GitBranch;
  label: string;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={title}
      className={cn(CHIP, active && CHIP_ACTIVE)}
    >
      <Icon aria-hidden className={cn("size-3 shrink-0", active && "text-primary")} />
      {label}
    </button>
  );
}
