import type { ReactNode } from "react";

import type { FactoryBatch } from "./useFactoryBatch";

/**
 * In place of the prompt, when the dialog starts several backlog items: the
 * items picked on the board. Each becomes its own Factory task with the
 * configuration below.
 * @param props.batch The picked items.
 * @param props.toolbar The harness and model controls, as under a prompt.
 */
export function FactoryItems({ batch, toolbar }: { batch: FactoryBatch; toolbar: ReactNode }) {
  return (
    <section
      aria-label="Backlog items to start"
      className="flex flex-col gap-3 rounded-xl bg-card p-3"
    >
      <p className="text-[13px] text-muted-foreground">
        {batch.count} item{batch.count === 1 ? "" : "s"} from the backlog
      </p>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto text-[13px]">
        {batch.selected.map((item) => (
          <li key={item.id} className="flex min-w-0 gap-2">
            <span className="tnum shrink-0 text-muted-foreground">{item.number || "·"}</span>
            <span className="truncate">{item.title}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Each item becomes its own Factory task with the settings below, working from the item's
        text. Items that already have a Factory task are skipped.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">{toolbar}</div>
    </section>
  );
}
