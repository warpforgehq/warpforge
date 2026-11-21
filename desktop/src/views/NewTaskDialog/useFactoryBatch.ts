import type { WorkItem } from "@/components/backlog/types";

/** Backlog items the New Task dialog starts in Factory in one go. */
export interface FactorySeed {
  kind: "items";
  items: WorkItem[];
}

/**
 * The backlog items a Factory batch starts, picked on the board.
 * @param seed What the dialog was opened with.
 * @returns The items, how many there are, and their ids for the start call.
 */
export function useFactoryBatch(seed: FactorySeed) {
  const selected = seed.items;
  return {
    count: selected.length,
    resolveIds: async (): Promise<string[]> => selected.map((item) => item.id),
    selected,
  };
}

export type FactoryBatch = ReturnType<typeof useFactoryBatch>;
