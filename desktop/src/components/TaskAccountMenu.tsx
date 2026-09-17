import { LoaderCircle, RefreshCcw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { AgentAccountLimitsRow } from "@/components/AgentAccountLimitsRow";
import { AgentLogo } from "@/components/AgentLogo";
import EmailBlur from "@/components/EmailBlur";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccountSwitch } from "@/hooks/useAccountSwitch";
import { useAgentLimits } from "@/hooks/useAgentLimits";
import { useAgentSpend } from "@/hooks/useAgentSpend";
import { buildAccountCards, SWITCH_NOTE, type AccountCard } from "@/lib/accounts";
import {
  headlineWindows,
  limitRamp,
  LIMIT_BAR_RAMP_CLASSES,
  percentLeft,
  SPEND_DISCLAIMER,
} from "@/lib/agentLimits";
import { agentDisplayName } from "@/lib/agentNames";
import { usageWindowShortLabel } from "@/lib/usageWindowLabel";
import { cn } from "@/lib/utils";
import type { AccountInfo, AgentConfig, AgentLimitWindow, AgentSpend } from "@/protocol";

/**
 * The open task's harness, its account, and its quota — one control.
 *
 * These used to be two neighbouring dropdowns: a "N% left" pill listing every
 * harness's quota, and an account chip listing the same accounts to switch
 * between. But "which account should I move to" is decided *on* the quota, so
 * the numbers and the switch have to sit in one place or you close one popup to
 * open the other.
 *
 * The trigger doubles as the task's harness identity, so it renders even with
 * no quota data — logo and account label, quota appended only when the daemon
 * has reported some. The menu keeps every harness, not just this task's: a
 * Claude task can spawn Codex sub-agents, so the footprint is wider than the
 * task's own agent. It is merely *ordered*, this harness first.
 */
export function TaskAccountMenu({
  agentId,
  agents,
  accounts,
}: {
  agentId: string;
  agents: AgentConfig[];
  accounts: AccountInfo[];
}) {
  const { accounts: limits, refresh } = useAgentLimits();
  const { agents: spend } = useAgentSpend();
  const { pending, error, select } = useAccountSwitch();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const cards = useMemo(
    () => buildAccountCards(accounts, limits, agentId),
    [accounts, limits, agentId],
  );

  const displayName = agentDisplayName(agentId, agents.find((a) => a.id === agentId)?.displayName);
  const activeCard = cards.find((card) => card.agentId === agentId && card.active) ?? null;
  // Session over Weekly, both at a glance — one number could not tell you
  // whether the hour or the week is the thing about to run out.
  const headline = activeCard?.limits ? headlineWindows(activeCard.limits.windows) : null;
  const shown = [headline?.session, headline?.weekly].filter(
    (window): window is AgentLimitWindow => window != null,
  );

  if (cards.length === 0) {
    // Nothing signed in for this harness yet. Still say which harness the task
    // runs on, at the same footprint as the chip, so the row doesn't jump once
    // a first account appears.
    return (
      <span
        className="flex h-5 shrink-0 items-center gap-1.5 rounded px-1.5 text-[11px] text-muted-foreground"
        title={displayName}
      >
        <AgentLogo agentId={agentId} displayName={displayName} className="size-3.5" />
        <span className="max-w-28 truncate">{displayName}</span>
      </span>
    );
  }

  // Name the login only when there is a choice to name. A harness with one
  // login has nothing to disambiguate, and its label is often a placeholder the
  // daemon invented ("Signed in") — so the button reads "OpenCode", not
  // "OpenCode · Signed in". Same rule the cards use for their own labels.
  // "Select account" is only an instruction when there is something to select.
  // A harness warpforge holds no accounts for (Pi) has nothing to offer, so the
  // button is just its name — and one login needs no naming either, since its
  // label is often a placeholder the daemon invented ("Signed in").
  const ownCards = cards.filter((card) => card.agentId === agentId).length;
  const label = activeCard
    ? ownCards > 1
      ? activeCard.label
      : displayName
    : ownCards > 0
      ? "Select account"
      : displayName;
  // Don't repeat the harness back at itself ("Claude Code: Claude Code") when
  // the label already is the harness name.
  const titleHead = label === displayName ? displayName : `${displayName}: ${label}`;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex h-5 min-w-0 items-center gap-1.5 rounded px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={`${displayName} account`}
          title={`${titleHead}${shown.map((w) => ` · ${w.label}: ${quotaSentence(w)}`).join("")}`}
        >
          <AgentLogo agentId={agentId} displayName={displayName} className="size-3.5" />
          <span className="max-w-28 truncate">
            <EmailBlur text={label} />
          </span>
          {shown.length > 0 && (
            <span aria-hidden className="flex min-w-0 items-center gap-1.5">
              {shown.map((window) => (
                <QuotaBar key={window.id} window={window} />
              ))}
            </span>
          )}
          {pending !== null && <LoaderCircle className="size-3 animate-spin" />}
        </DropdownMenuTrigger>
        {/* Capped to the viewport so a machine with several harnesses signed in
            scrolls instead of running off a short screen. */}
        <DropdownMenuContent
          side="top"
          align="start"
          className="max-h-[min(80vh,32rem)] w-80 space-y-2 overflow-y-auto p-2"
        >
          {cards.map((card) => (
            <AccountCardItem
              key={card.id}
              card={card}
              spend={
                card.showSpend ? (spend?.find((s) => s.agentId === card.agentId) ?? null) : null
              }
              pending={pending}
              onSelect={select}
            />
          ))}
          {spend && spend.length > 0 && (
            <p className="px-1 text-[11px] text-muted-foreground/80">{SPEND_DISCLAIMER}</p>
          )}
          <p className="px-1 text-[11px] leading-snug text-muted-foreground">{SWITCH_NOTE}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex w-full items-center justify-center gap-1.5 rounded px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCcw className="size-3" />
            Refresh
          </button>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Reachable without opening the menu: a stale number is the reason you
          come here, and the menu's own Refresh is one click further in. */}
      <button
        type="button"
        aria-label="Refresh usage"
        title="Refresh usage"
        onClick={() => void onRefresh()}
        disabled={refreshing}
        className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
      >
        <RefreshCcw aria-hidden className={cn("size-3", refreshing && "animate-spin")} />
      </button>
      {/* Outside the dropdown on purpose: the menu can close on the same frame a
          switch fails, and an error rendered inside it would go with it. */}
      {error && (
        <span className="max-w-64 truncate text-[11px] text-warn" role="status" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * One inline window: a bar filled by quota LEFT, beside the quota LEFT —
 * "[bar] 56% 5h". The two have to agree: a fill that follows the used share
 * while the number beside it reports the remaining share reads as an inversion
 * ("100%" next to an empty bar). The ramp still follows the used share, so the
 * colour is what warns. The tooltip spells the number out in words.
 */
function QuotaBar({ window }: { window: AgentLimitWindow }) {
  const spent = window.usedPercent >= 100;
  const left = spent ? 0 : percentLeft(window.usedPercent);
  return (
    <span className="flex min-w-0 items-center gap-1" data-window={window.id}>
      <span className="h-1 w-10 min-w-4 shrink overflow-hidden rounded-full bg-muted">
        <span
          className={`block h-full rounded-full ${LIMIT_BAR_RAMP_CLASSES[limitRamp(window.usedPercent)]}`}
          style={{ width: `${left}%` }}
        />
      </span>
      <span
        className={`shrink-0 whitespace-nowrap text-[10px] tabular-nums ${
          spent ? "text-destructive" : "text-muted-foreground"
        }`}
      >
        {spent ? "exhausted" : `${left}%`} {usageWindowShortLabel(window)}
      </span>
    </span>
  );
}

function quotaSentence(window: AgentLimitWindow): string {
  return window.usedPercent >= 100 ? "exhausted" : `${percentLeft(window.usedPercent)}% left`;
}

function AccountCardItem({
  card,
  spend,
  pending,
  onSelect,
}: {
  card: AccountCard;
  spend: AgentSpend | null;
  pending: string | null;
  onSelect: (agentId: string, accountId: string) => void;
}) {
  // No action on the account already in use — the header's ACTIVE badge says so,
  // and a live login nobody registered has no id the daemon would accept. Null
  // rather than a component that returns null, so the foot row can tell.
  const action =
    card.active || !card.account ? null : (
      <AccountAction card={card} account={card.account} pending={pending} onSelect={onSelect} />
    );
  if (!card.limits) return <PlainAccountCard card={card} action={action} />;
  return (
    <AgentAccountLimitsRow
      // Identity comes from the account list: the limits snapshot carries its
      // own `active` flag but is 20 minutes stale, so it would still point at
      // the login you just switched away from.
      account={{ ...card.limits, active: card.active, label: card.label }}
      showLabel={card.showLabel}
      spend={spend}
      action={action}
    />
  );
}

/**
 * Switching is global for the harness and resumes open sessions elsewhere, so
 * it is an explicit control rather than a click on the card — a mis-click on
 * something you opened to *read* must not move your task's account.
 */
function AccountAction({
  card,
  account,
  pending,
  onSelect,
}: {
  card: AccountCard;
  account: AccountInfo;
  pending: string | null;
  onSelect: (agentId: string, accountId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Use ${card.label}`}
      disabled={pending !== null}
      onClick={() => onSelect(card.agentId, account.id)}
      className="inline-flex cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
    >
      {pending === account.id && <LoaderCircle className="size-3 animate-spin" />}
      Use this account
    </button>
  );
}

/** An account the daemon has never polled: no numbers to show, still switchable. */
function PlainAccountCard({ card, action }: { card: AccountCard; action: ReactNode }) {
  return (
    <div className="space-y-3 rounded-md border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <AgentLogo
          agentId={card.agentId}
          displayName={agentDisplayName(card.agentId)}
          className="size-4 shrink-0"
        />
        <span className="min-w-0 truncate text-[13px] font-semibold text-foreground">
          {agentDisplayName(card.agentId)}
          {card.showLabel && (
            <span className="font-medium text-muted-foreground">
              {" · "}
              <EmailBlur text={card.label} />
            </span>
          )}
        </span>
        {card.plan && (
          <span className="rounded-sm border border-border bg-muted/50 px-1.5 py-px text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {card.plan}
          </span>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground">No usage reported for this account yet.</p>
      {/* Never polled, so there is no timestamp to sit on the left of this row —
          only the action, and nothing at all when it is the active account. */}
      {action && (
        <div className="flex items-center justify-end border-t border-rule pt-2">{action}</div>
      )}
    </div>
  );
}
