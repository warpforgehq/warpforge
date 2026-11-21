import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  INBOX_SCOPES,
  type InboxScope,
  PULL_STATE_FILTERS,
  type PullStateFilter,
} from "@/lib/inboxFilters";

const SCOPE_LABEL: Record<InboxScope, string> = {
  review: "To review",
  mine: "Mine",
  everyone: "Everyone",
};

const STATE_LABEL: Record<PullStateFilter, string> = {
  open: "Open",
  all: "All",
};

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return list.some((item) => item === value);
}

/**
 * Which pull requests the inbox lists: whose, and in which state.
 *
 * @param props.scope Whose pull requests are listed.
 * @param props.onScopeChange Called with the newly picked scope.
 * @param props.state Open only, or every state.
 * @param props.onStateChange Called with the newly picked state.
 */
export function InboxViewMenu({
  scope,
  onScopeChange,
  state,
  onStateChange,
}: {
  scope: InboxScope;
  onScopeChange: (scope: InboxScope) => void;
  state: PullStateFilter;
  onStateChange: (state: PullStateFilter) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Which pull requests to show"
          className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-secondary/60 px-2 text-[13px] text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {SCOPE_LABEL[scope]}
          {state === "all" && <span className="text-muted-foreground">· all</span>}
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Show</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={scope}
          onValueChange={(value) => {
            if (isOneOf(INBOX_SCOPES, value)) onScopeChange(value);
          }}
        >
          {INBOX_SCOPES.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {SCOPE_LABEL[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">State</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={state}
          onValueChange={(value) => {
            if (isOneOf(PULL_STATE_FILTERS, value)) onStateChange(value);
          }}
        >
          {PULL_STATE_FILTERS.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {STATE_LABEL[value]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
