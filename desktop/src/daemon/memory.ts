import type { MemoryStats } from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function MemoryMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  return class extends Base {
    async memoryStats(): Promise<MemoryStats> {
      return (await this.request("memory.stats", {})) as MemoryStats;
    }

    async setMemoryEmbedding(mode: string): Promise<MemoryStats> {
      return (await this.request("memory.setEmbedding", { mode })) as MemoryStats;
    }

    async memoryDream(dryRun: boolean, projectId?: string | null): Promise<unknown> {
      return this.request("memory.dream", { dry_run: dryRun, project_id: projectId ?? null });
    }
  };
}
