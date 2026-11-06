import {
  currentFindings,
  KEEPER_STATUS_META,
  keeperOn,
  keeperPrecision,
  keeperRuns,
  keeperStatus,
  latestDraft,
} from "@/lib/keepers";
import { cn } from "@/lib/utils";
import type { KeeperDecision as Decision, KeeperEntry, KeeperTaskState } from "@/protocol";
import { Toggle } from "@/views/settings/primitives";

import { KeeperDecision } from "./KeeperDecision";
import { KeeperDraft } from "./KeeperDraft";
import { KeeperFindingRow } from "./KeeperFindingRow";
import { KeeperStrip } from "./KeeperStrip";

export interface KeeperActions {
  onSwitch: (keeperId: string, on: boolean) => Promise<void>;
  onDismiss: (findingId: string, reason: string) => Promise<void>;
  onDecide: (
    keeperId: string,
    decision: Decision,
    options?: { rounds?: number; note?: string },
  ) => Promise<void>;
  onOpenFile: (path: string, location?: { line?: number }) => void;
}

/**
 * One keeper on one task: its switch, state, strip, precision, current
 * findings and, when its loop stopped, the owner's choice.
 * @param entry The keeper file, valid.
 * @param state The task's keeper state, if fetched.
 * @param actions What the controls call.
 * @returns The card.
 */
export function KeeperCard({
  entry,
  state,
  ...actions
}: { entry: KeeperEntry; state: KeeperTaskState | undefined } & KeeperActions) {
  const definition = entry.definition;
  const on = keeperOn(entry.id, definition, state);
  const runs = keeperRuns(state, entry.id);
  const loop = state?.loops[entry.id];
  const status = keeperStatus(on, runs, loop);
  const findings = on ? currentFindings(state, runs) : [];
  const precision = keeperPrecision(state, entry.id);
  const draft = on ? latestDraft(runs) : null;
  const name = definition?.name || entry.id;
  const switchId = `keeper-switch-${entry.id}`;

  return (
    <article
      aria-label={`${name} keeper`}
      data-status={status}
      className="flex flex-col gap-2 border-b border-border px-3 py-3"
    >
      <header className="flex min-w-0 items-center gap-2">
        <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
          <span className="block truncate text-[13px] font-semibold text-foreground">{name}</span>
          {definition?.description && (
            <span className="block truncate text-xs text-muted-foreground">
              {definition.description}
            </span>
          )}
        </label>
        <span className={cn("shrink-0 text-xs font-medium", KEEPER_STATUS_META[status].tone)}>
          {KEEPER_STATUS_META[status].label}
          {status === "findings" && findings.length > 0 ? ` · ${findings.length}` : ""}
        </span>
        <Toggle id={switchId} checked={on} onChange={(next) => actions.onSwitch(entry.id, next)} />
      </header>
      {status === "waiting" && loop?.reason && (
        <p className="text-xs text-warn">Waiting: {loop.reason}</p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <KeeperStrip runs={runs} when={definition?.when} />
        {definition?.result !== "draft" && (
          <span className="text-xs text-muted-foreground">
            {precision
              ? `Precision ${Math.round(precision.ratio * 100)}% of ${precision.sample} resolved`
              : "Precision: nothing resolved yet"}
          </span>
        )}
      </div>
      {draft && <KeeperDraft name={name} text={draft} />}
      {status === "needs_you" && loop && (
        <KeeperDecision
          loop={loop}
          onDecide={(decision, options) => actions.onDecide(entry.id, decision, options)}
        />
      )}
      {findings.length > 0 && (
        <ul aria-label={`${name} findings`} className="flex flex-col">
          {findings.map((finding) => (
            <KeeperFindingRow
              key={finding.id}
              finding={finding}
              onOpenFile={actions.onOpenFile}
              onDismiss={(reason) => actions.onDismiss(finding.id, reason)}
            />
          ))}
        </ul>
      )}
    </article>
  );
}
