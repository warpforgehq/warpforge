import { useCallback, useState } from "react";

/**
 * A busy flag around one action at a time: set while the action runs and
 * cleared however it settles.
 * @returns The flag, and a wrapper that runs an action under it.
 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (act: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await act();
    } finally {
      setBusy(false);
    }
  }, []);
  return [busy, run] as const;
}
