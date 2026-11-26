import { Search } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { useAutomationsQuery } from "@/hooks/useAutomations";
import { cn } from "@/lib/utils";
import type { Automation } from "@/protocol";
import { useUi } from "@/store/ui";

import { isSkipped, runStatusMeta } from "./labels";

const STATE_FILTERS = {
  all: "All states",
  enabled: "Enabled",
  paused: "Paused",
};

const OUTCOME_FILTERS = {
  all: "Any outcome",
  completed: "Completed",
  failed: "Failed",
  skipped: "Skipped",
  never: "Never run",
};

const runTime = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "numeric",
});

function AutomationRow({
  automation,
  selected,
  onSelect,
}: {
  automation: Automation;
  selected: boolean;
  onSelect: () => void;
}) {
  const { enabled, lastRunAt, lastStatus, name, nextRunAt } = automation;
  const next = enabled && nextRunAt ? runTime.format(nextRunAt * 1000) : "—";
  const last = lastRunAt ? runTime.format(lastRunAt * 1000) : "Never";
  const outcome = runStatusMeta(lastStatus);

  return (
    <li>
      <button
        type="button"
        aria-current={selected || undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium">{name}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", enabled ? "bg-ok" : "bg-muted-foreground/50")}
            />
            {enabled ? "Enabled" : "Paused"}
          </span>
        </span>
        <span className="flex justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate" title={`Next: ${next}`}>
            Next {next}
          </span>
          <span className="flex min-w-0 items-center gap-1">
            {outcome && (
              <span
                aria-label={outcome.label}
                title={outcome.label}
                role="img"
                className={cn("size-1.5 shrink-0 rounded-full", outcome.dot)}
              />
            )}
            <span className="truncate" title={`Last: ${last}`}>
              Last {last}
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

export function AutomationList({ onNavigate }: { onNavigate?: () => void }) {
  const query = useAutomationsQuery();
  const storedId = useUi((state) => state.selectedAutomationId);
  const selectedId = query.data?.some(({ id }) => id === storedId) ? storedId : null;
  const selectAutomation = useUi((state) => state.selectAutomation);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const term = search.trim().toLowerCase();
  const automations = query.data?.filter((automation) => {
    if (term && !`${automation.name}\n${automation.prompt}`.toLowerCase().includes(term)) {
      return false;
    }
    if (stateFilter !== "all" && automation.enabled !== (stateFilter === "enabled")) return false;
    const last = automation.lastStatus;
    if (outcomeFilter === "all") return true;
    if (outcomeFilter === "skipped") return last != null && isSkipped(last);
    if (outcomeFilter === "never") return last == null;
    return last === outcomeFilter;
  });

  function select(id: string | null) {
    selectAutomation(id);
    onNavigate?.();
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 px-2 pb-2">
      <button
        type="button"
        aria-current={selectedId === null || undefined}
        onClick={() => select(null)}
        className={cn(
          "rounded-md px-2 py-1.5 text-left text-[13px] font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          selectedId === null ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
        )}
      >
        Overview
      </button>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Search automations"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search name or prompt"
          className="h-8 pl-7 text-[13px]"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Filter
          label="Automation state"
          options={STATE_FILTERS}
          value={stateFilter}
          onChange={setStateFilter}
        />
        <Filter
          label="Last run outcome"
          options={OUTCOME_FILTERS}
          value={outcomeFilter}
          onChange={setOutcomeFilter}
        />
      </div>
      {query.isLoading ? (
        <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
          Loading automations…
        </p>
      ) : query.isError ? (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          Could not load automations.
        </p>
      ) : automations?.length ? (
        <ul aria-label="Automations" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {automations.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              selected={selectedId === automation.id}
              onSelect={() => select(automation.id)}
            />
          ))}
        </ul>
      ) : (
        <p role="status" className="px-2 py-1 text-xs text-muted-foreground">
          {query.data?.length ? "No automations match these filters" : "No automations yet"}
        </p>
      )}
    </div>
  );
}

function Filter({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Record<string, string>;
  value: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-7 min-w-0 rounded-md border border-input bg-background px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {Object.entries(options).map(([id, name]) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </select>
  );
}
