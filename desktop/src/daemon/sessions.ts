import { coalesceUpdates, mergeSessionHistory } from "../lib/sessionStream";
import type { HistorySettings, SessionUpdate } from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function SessionMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  // ── Session history (lazy) ────────────────────────────────────────────────
  // The connection snapshot carries no transcripts, so a connect never reads
  // the whole transcripts table. A task's full conversation loads once, when
  // a chat showing it is first opened, and the transcript mounts only after
  // the fetch settles — nothing is ever prepended above the viewport of a
  // mounted list (docs/adr/0005).
  return class extends Base {
    /** One task's full folded conversation history, straight from the daemon. */
    async sessionHistory(taskId: string): Promise<SessionUpdate[]> {
      const result = await this.request("session.history", { task_id: taskId });
      const updates = (result as { updates?: SessionUpdate[] })?.updates;
      return Array.isArray(updates) ? updates : [];
    }

    /**
     * Fetch a task's full conversation once and merge it under whatever live
     * updates arrived while the fetch was in flight. The daemon flushes its
     * write-behind queue before the read, so everything the live copy already
     * showed is in the fetch — only the in-flight tail is carried over.
     *
     * Always resolves, even when the daemon cannot answer: the chat then mounts
     * on an empty transcript and refills from live events, rather than spinning
     * forever. A later open retries a failed fetch.
     */
    loadSessionHistory(taskId: string): Promise<void> {
      if (this.demoDiff) return Promise.resolve();
      let pending = this.historyLoads.get(taskId);
      if (!pending) {
        pending = this.fetchSessionHistory(taskId).catch(() => {
          this.historyLoads.delete(taskId);
        });
        this.historyLoads.set(taskId, pending);
      }
      return pending;
    }

    private async fetchSessionHistory(taskId: string): Promise<void> {
      const fetched = coalesceUpdates(await this.sessionHistory(taskId));
      const existing = this.state.sessionUpdates[taskId] ?? [];
      this.setState({
        sessionUpdates: {
          ...this.state.sessionUpdates,
          [taskId]: mergeSessionHistory(fetched, existing),
        },
      });
    }

    forgetSessionHistory(taskId: string) {
      this.historyLoads.delete(taskId);
    }

    // ── History retention settings ────────────────────────────────────────────

    async historySettings(): Promise<HistorySettings> {
      return (await this.request("history.getSettings", {})) as HistorySettings;
    }

    async setHistorySettings(settings: HistorySettings): Promise<HistorySettings> {
      return (await this.request("history.setSettings", {
        retention_days: settings.retentionDays,
        settle_ignored_after_days: settings.settleIgnoredAfterDays,
        delete_closed_after_days: settings.deleteClosedAfterDays,
      })) as HistorySettings;
    }
  };
}
