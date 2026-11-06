import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { KeeperDecision as Decision, KeeperLoopState } from "@/protocol";

const STOP_REASON: Record<NonNullable<KeeperLoopState["stop"]>, string> = {
  max_rounds: "used its fix rounds",
  no_progress: "stopped making progress",
};

/**
 * The choice a stopped fix loop waits for: more rounds with optional
 * guidance, accept the change as it is, or switch the keeper off.
 * @param loop The keeper's loop, stopped.
 * @param onDecide Sends the owner's answer.
 * @returns The choice panel.
 */
export function KeeperDecision({
  loop,
  onDecide,
}: {
  loop: KeeperLoopState;
  onDecide: (decision: Decision, options?: { rounds?: number; note?: string }) => Promise<void>;
}) {
  const [extending, setExtending] = useState(false);
  const [rounds, setRounds] = useState(2);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const decide = async (decision: Decision, options?: { rounds?: number; note?: string }) => {
    setBusy(true);
    try {
      await onDecide(decision, options);
    } finally {
      setBusy(false);
    }
  };

  const why = loop.stop ? STOP_REASON[loop.stop] : "stopped";
  return (
    <section
      aria-label="Keeper needs you"
      className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
    >
      <p className="text-[13px] text-foreground">
        It {why} after {loop.rounds} of {loop.maxRounds} rounds. What next?
      </p>
      {extending ? (
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void decide("extend", { note, rounds });
          }}
        >
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            More rounds
            <Input
              type="number"
              min={1}
              max={5}
              value={rounds}
              onChange={(event) => setRounds(Math.max(1, Number(event.target.value) || 1))}
              className="h-7 w-16 text-[13px]"
            />
          </label>
          <Input
            aria-label="Guidance for the fix (optional)"
            placeholder="Guidance for the fix (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className="h-7 text-[13px]"
          />
          <div className="flex gap-1.5">
            <Button type="submit" size="sm" disabled={busy}>
              Extend
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setExtending(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" disabled={busy} onClick={() => setExtending(true)}>
            Extend…
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide("accept")}>
            Accept
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide("off")}>
            Off for this task
          </Button>
        </div>
      )}
    </section>
  );
}
