import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AgentUpdateDismissalState {
  /** `id@latestVersion` keys the user closed the banner for. */
  dismissed: string[];
  /** Add the updates pending now to the dismissed keys. */
  dismiss: (keys: readonly string[]) => void;
}

/** Per device; keyed by version so the next release announces itself again. */
export const useAgentUpdateDismissal = create<AgentUpdateDismissalState>()(
  persist(
    (set) => ({
      dismissed: [],
      dismiss: (keys) =>
        set((state) => ({ dismissed: [...new Set([...state.dismissed, ...keys])] })),
    }),
    {
      name: "wf-agent-update-dismissal",
      partialize: (state) => ({ dismissed: state.dismissed }),
      version: 1,
    },
  ),
);
