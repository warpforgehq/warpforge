import { Check, ChevronDown, GitBranch } from "lucide-react";

import { SmithAvatar } from "@/components/SmithAvatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { agentDisplayName } from "@/lib/agentNames";
import { cn } from "@/lib/utils";

import { AgentLogo } from "../../components/AgentLogo";
import type { AgentConfig, Smith } from "../../protocol";

/** Deliberately the same shape and weight as `AgentConfigBar`'s selectors —
 *  these sit in the same toolbar row, so anything heavier makes the harness
 *  picker read as a different kind of control than the model picker. */
export const CHIP =
  "flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground";
export const CHIP_ACTIVE = "bg-secondary text-foreground";

export function ChipDivider() {
  return <span aria-hidden className="mx-0.5 h-3.5 w-px shrink-0 bg-border" />;
}

const NO_SMITHS: Smith[] = [];

/** "Claude Code · opus": what a Smith runs on. */
function smithRuns(smith: Smith): string {
  return [agentDisplayName(smith.agent), smith.model].filter(Boolean).join(" · ");
}

export function HarnessChip({
  agent,
  agents,
  label = "Harness",
  onChange,
  title,
  smiths = NO_SMITHS,
  smith,
  onSmith,
}: {
  agent: string;
  agents: AgentConfig[];
  label?: string;
  onChange: (next: string) => void;
  title: string;
  /** Smiths to offer above the agents; none, no group. */
  smiths?: Smith[];
  /** The Smith picked instead of an agent. */
  smith?: Smith;
  onSmith?: (id: string) => void;
}) {
  const current = agents.find((candidate) => candidate.id === agent);
  const currentName = agentDisplayName(agent, current?.displayName);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={smith ? smithRuns(smith) : title}
          className={CHIP}
        >
          {smith ? (
            <SmithAvatar smith={smith} size="size-3.5" className="[&>span]:text-[8px]" />
          ) : (
            <AgentLogo agentId={agent} displayName={currentName} className="size-3.5 shrink-0" />
          )}
          <span className="max-w-32 truncate">{smith ? smith.name : currentName}</span>
          <ChevronDown aria-hidden className="size-3 shrink-0 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {smiths.length > 0 && onSmith && (
          <>
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
              Smiths
            </DropdownMenuLabel>
            {smiths.map((candidate) => (
              <DropdownMenuItem
                key={candidate.id}
                className="text-[13px]"
                onSelect={() => onSmith(candidate.id)}
              >
                <SmithAvatar smith={candidate} size="size-4" className="[&>span]:text-[9px]" />
                <span className="truncate">{candidate.name}</span>
                <span className="flex-1 truncate text-[11px] text-muted-foreground">
                  {smithRuns(candidate)}
                </span>
                {smith?.id === candidate.id && <Check aria-hidden className="size-3.5 shrink-0" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
              Agents
            </DropdownMenuLabel>
          </>
        )}
        {agents.map((candidate) => {
          const name = agentDisplayName(candidate.id, candidate.displayName);
          return (
            <DropdownMenuItem
              key={candidate.id}
              className="text-[13px]"
              onSelect={() => onChange(candidate.id)}
            >
              <AgentLogo agentId={candidate.id} displayName={name} className="size-3.5 shrink-0" />
              <span className="flex-1 truncate">{name}</span>
              {!smith && agent === candidate.id && (
                <Check aria-hidden className="size-3.5 shrink-0" />
              )}
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

/**
 * A Smith's model and account in New Task: shown, not picked here.
 * @param props.smith the Smith picked
 * @param props.accountLabel its account's label, when it has one
 * @returns the locked chips
 */
export function SmithLockedChips({ smith, accountLabel }: { smith: Smith; accountLabel?: string }) {
  const where = `Set in ${smith.name}'s settings`;
  // A span, not a disabled button: WebKit shows no tooltip on a disabled control.
  const locked = cn(CHIP, "cursor-not-allowed opacity-60 hover:bg-transparent");
  return (
    <>
      <span role="button" aria-disabled="true" aria-label="Model" title={where} className={locked}>
        <span className="max-w-32 truncate">{smith.model ?? "Default model"}</span>
      </span>
      {smith.accountId && (
        <span
          role="button"
          aria-disabled="true"
          aria-label="Account"
          title={where}
          className={locked}
        >
          <span className="max-w-32 truncate">{accountLabel ?? smith.accountId}</span>
        </span>
      )}
    </>
  );
}
