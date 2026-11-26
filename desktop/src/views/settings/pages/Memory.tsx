import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { daemon } from "@/daemon";

/** What the daemon needs before hybrid search can work, spelled out once. */
const FASTEMBED_HELP =
  "Downloads a ~80 MB model (all-MiniLM-L6-v2) on first use and needs ONNX Runtime — on macOS, brew install onnxruntime. Falls back to keyword search when unavailable or offline.";

export default function MemoryPage() {
  const queryClient = useQueryClient();
  const [confirmingFastembed, setConfirmingFastembed] = useState(false);
  const memoryStats = useQuery({
    queryKey: ["memory", "stats"],
    queryFn: () => daemon.memoryStats(),
  });

  /**
   * Switch the memory embedding mode. Failures and half-applied switches are
   * reported as toasts: `alert` is as invisible in this webview as
   * `window.confirm`, so the news never reached anyone.
   */
  const applyEmbeddingMode = async (mode: string) => {
    try {
      const stats = (await daemon.setMemoryEmbedding(mode)) as typeof memoryStats.data;
      queryClient.setQueryData(["memory", "stats"], stats);
      if (mode === "fastembed" && stats?.embeddingMode !== "hybrid") {
        toast.warning("Still on keyword search (FTS)", {
          description: stats?.embeddingUnavailable
            ? `fastembed is not available: ${stats.embeddingUnavailable}. On macOS: brew install onnxruntime, then re-select fastembed — no restart needed. If it still fails, restart Warpforge so ORT_DYLIB_PATH picks up /opt/homebrew/lib/libonnxruntime.dylib.`
            : "The ~80 MB model downloads on the next search. Offline, it stays on FTS.",
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const stats = memoryStats.data;
  const hybrid = stats?.embeddingMode === "hybrid";
  const dreaming = (stats as any)?.dreaming;

  const facts: { label: string; value: string; title: string }[] = [
    {
      label: "memories",
      value: memoryStats.isLoading
        ? "…"
        : `${stats?.globalCount ?? 0} global · ${stats?.projectCount ?? 0} project`,
      title: "Durable cross-session knowledge, shared across harnesses.",
    },
    {
      label: "scopes",
      value:
        [stats?.scopesEnabled.global && "global", stats?.scopesEnabled.project && "project"]
          .filter(Boolean)
          .join(" · ") || "none",
      title:
        "Which scopes agents may store and search. Edit ~/.warpforge/config.yaml → memory.global / memory.project, then restart the daemon.",
    },
    {
      label: "project db",
      value: memoryStats.isLoading ? "…" : stats?.perProjectDbExists ? "yes" : "global only",
      title:
        "~/.warpforge/memory.db is global; a per-project overlay is created on the first project-scoped write.",
    },
    {
      label: "dreaming",
      value: `${dreaming?.enabled ? "on" : "off"} (${dreaming?.trigger ?? "manual"})`,
      title:
        "Automatic memory compaction. Edit ~/.warpforge/config.yaml → memory.dreaming, then restart the daemon. Run it by hand from Advanced.",
    },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <label
          id="embedding-mode"
          tabIndex={-1}
          className="flex items-center gap-2 text-[0.75rem] text-muted-foreground"
          title={
            hybrid
              ? "Hybrid: keywords plus meaning. Falls back to keywords offline."
              : FASTEMBED_HELP
          }
        >
          Search
          <select
            aria-label="Embedding mode"
            value={hybrid ? "fastembed" : "none"}
            disabled={memoryStats.isLoading}
            onChange={(e) => {
              // The select is controlled by the daemon's answer, so a
              // pick that is not applied snaps back on the next render —
              // there is nothing to undo here.
              const mode = e.target.value;
              if (mode === "fastembed") {
                setConfirmingFastembed(true);
                return;
              }
              void applyEmbeddingMode(mode);
            }}
            className="h-7 rounded-md border bg-background px-2 text-[0.75rem] text-foreground"
          >
            <option value="none">Keywords</option>
            <option value="fastembed">Hybrid (~80 MB)</option>
          </select>
        </label>
        {facts.map((fact) => (
          <span
            key={fact.label}
            title={fact.title}
            className="flex items-center gap-1.5 font-mono text-[0.6875rem]"
          >
            <span className="text-muted-foreground/60">{fact.label}</span>
            <span className="tabular-nums text-foreground/80">{fact.value}</span>
          </span>
        ))}
      </div>

      {stats?.embeddingUnavailable && (
        <p className="text-[0.6875rem] text-warn">
          Last attempt at hybrid search failed: {stats.embeddingUnavailable}. On macOS,{" "}
          <span className="font-mono">brew install onnxruntime</span>, then pick Hybrid again.
        </p>
      )}

      <ConfirmDialog
        open={confirmingFastembed}
        title="Switch to hybrid search?"
        description={FASTEMBED_HELP}
        confirmLabel="Switch to hybrid"
        busyLabel="Switching…"
        destructive={false}
        onCancel={() => setConfirmingFastembed(false)}
        onConfirm={async () => {
          await applyEmbeddingMode("fastembed");
          setConfirmingFastembed(false);
        }}
      />
    </div>
  );
}
