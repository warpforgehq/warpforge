import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import type { Smith, SmithDetail } from "@/protocol";

interface Props {
  smith: Smith;
  onResolved: (detail: SmithDetail) => void;
}

/** Shown while a teammate's soul or charter was edited outside Warpforge: it
 *  starts nothing until the user keeps or throws away the edit. */
export function HeldBanner({ smith, onResolved }: Props) {
  const [busy, setBusy] = useState(false);
  if (!smith.held?.includes("identity_changed")) return null;

  const resolve = async (accept: boolean) => {
    setBusy(true);
    try {
      onResolved(
        accept
          ? await daemon.acceptSmithIdentity(smith.id)
          : await daemon.revertSmithIdentity(smith.id),
      );
    } catch (error) {
      toast.error(accept ? "Could not keep the edit" : "Could not undo the edit", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px]"
    >
      <AlertTriangle aria-hidden className="size-4 shrink-0 text-warn" />
      <p className="min-w-0 flex-1">
        {smith.name}'s soul or charter was edited outside Warpforge. It starts no work until you
        keep the edit or undo it.
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void resolve(false)}
      >
        Undo edit
      </Button>
      <Button type="button" size="sm" disabled={busy} onClick={() => void resolve(true)}>
        Keep edit
      </Button>
    </div>
  );
}
