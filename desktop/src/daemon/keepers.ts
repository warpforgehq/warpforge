import { type KeeperRunsOn, setKeeperRunsOn } from "../lib/keeperRunsOn";
import { type KeeperPresetId, normalizeKeeperState, presetFile } from "../lib/keepers";
import type { FileDoc, KeeperDecision, KeeperEntry, KeeperTaskState } from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function KeeperMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  // ── Keeper RPCs (ADR 0030) ──
  return class extends Base {
    /** The project's keeper files, an invalid one carrying its parse error. */
    async listKeepers(project: string): Promise<KeeperEntry[]> {
      const result = await this.request("keepers.list", { project });
      const keepers = (result as { keepers?: KeeperEntry[] } | null)?.keepers;
      return Array.isArray(keepers) ? keepers : [];
    }

    /** Fetch a task's keeper state into `taskKeepers`; asks once more when a
     *  `task.keeper` event lands while the reply is in flight. */
    async refreshTaskKeepers(taskId: string, retry = true): Promise<void> {
      const asked = this.keeperEventSeq;
      const raw = (await this.request("keepers.state", {
        task_id: taskId,
      })) as Partial<KeeperTaskState> | null;
      if (retry && (this.keeperEventAt.get(taskId) ?? 0) > asked) {
        return this.refreshTaskKeepers(taskId, false);
      }
      this.setState({
        taskKeepers: { ...this.state.taskKeepers, [taskId]: normalizeKeeperState(taskId, raw) },
      });
    }

    async dismissKeeperFinding(taskId: string, findingId: string, reason?: string) {
      await this.request("keepers.dismiss", {
        finding_id: findingId,
        reason: reason?.trim() || null,
        task_id: taskId,
      });
      await this.refreshTaskKeepers(taskId);
    }

    /**
     * Accept the fixer's reply to a finding: a rebuttal dismisses it with the agent's
     * reason, a stale finding is fixed.
     * @param taskId The task.
     * @param findingId The finding the agent answered.
     */
    async acceptKeeperReply(taskId: string, findingId: string) {
      await this.request("keepers.acceptReply", { finding_id: findingId, task_id: taskId });
      await this.refreshTaskKeepers(taskId);
    }

    /** `rounds` and `note` apply to `extend` only. */
    async decideKeeper(
      taskId: string,
      keeperId: string,
      decision: KeeperDecision,
      options: { rounds?: number; note?: string } = {},
    ) {
      await this.request("keepers.decide", {
        decision,
        keeper_id: keeperId,
        note: decision === "extend" ? options.note?.trim() || null : null,
        rounds: decision === "extend" ? (options.rounds ?? null) : null,
        task_id: taskId,
      });
      await this.refreshTaskKeepers(taskId);
    }

    async setKeeperSwitch(taskId: string, keeperId: string, on: boolean) {
      await this.request("keepers.setSwitch", { keeper_id: keeperId, on, task_id: taskId });
      await this.refreshTaskKeepers(taskId);
    }

    /**
     * Send a keeper's open findings to the task's agent as one fix turn.
     * @param taskId The task.
     * @param keeperId The keeper whose findings are sent.
     */
    async sendKeeperFindings(taskId: string, keeperId: string) {
      await this.request("keepers.sendFindings", { keeper_id: keeperId, task_id: taskId });
      await this.refreshTaskKeepers(taskId);
    }

    /**
     * Run every ready keeper that is on for the task, on its HEAD now.
     * @param taskId The task.
     * @returns `head`, the HEAD the keepers check (null when the reply has none), and
     *   `started`, the ids of the keepers started; one already checking is not restarted.
     */
    async checkReadyKeepers(taskId: string): Promise<{ head: string | null; started: string[] }> {
      const result = await this.request("keepers.checkReady", { task_id: taskId });
      const reply = result as { head?: string; started?: string[] } | null;
      return {
        head: typeof reply?.head === "string" ? reply.head : null,
        started: Array.isArray(reply?.started) ? reply.started : [],
      };
    }

    /** Write a built-in keeper's two-line file into the project's checkout. */
    async addKeeper(project: string, preset: KeeperPresetId) {
      await this.request("file.save", { ...presetFile(preset), project, task_id: "" });
    }

    /**
     * Rewrite a keeper file's `agent`, `model` and `effort`, keeping its other lines.
     * @param project The project whose checkout holds the file.
     * @param keeperId The keeper's file stem.
     * @param runsOn The values to write; an unset one removes its key.
     */
    async saveKeeperRunsOn(project: string, keeperId: string, runsOn: KeeperRunsOn) {
      const read = async (path: string) => {
        const doc = (await this.request("file.contents", {
          path,
          project,
          task_id: "",
        })) as FileDoc;
        return { path, text: doc.newText };
      };
      const yaml = await read(`.warpforge/keepers/${keeperId}.yaml`);
      const file = yaml.text ? yaml : await read(`.warpforge/keepers/${keeperId}.yml`);
      if (!file.text) throw new Error(`.warpforge/keepers/${keeperId}.yaml is empty or missing`);
      const content = setKeeperRunsOn(file.text, runsOn);
      await this.request("file.save", { content, path: file.path, project, task_id: "" });
    }
  };
}
