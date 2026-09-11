export interface MemoryStats {
  globalCount: number;
  projectCount: number;
  embeddingMode: "hybrid" | "fts";
  scopesEnabled: {
    global: boolean;
    project: boolean;
  };
  perProjectDbExists: boolean;
  embeddingUnavailable?: string | null;
}
