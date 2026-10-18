import type { Smith, SmithDefaults, SmithDetail, SmithInput, SmithPatch } from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

/** `smiths.create` / `smiths.update` take snake_case keys; the permission and
 *  budget objects inside them are camelCase, like the `Smith` they return. */
function wireFields(input: SmithPatch & { homeProject?: string }) {
  const fields: Record<string, unknown> = {
    account_id: input.accountId,
    agent: input.agent,
    allowed_projects: input.allowedProjects,
    budget: input.budget,
    color: input.color,
    charter: input.charter,
    home_project: input.homeProject,
    model: input.model,
    name: input.name,
    permissions: input.permissions,
    soul: input.soul,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export function SmithMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  // ── Smith RPCs (ADR 0027) ──
  // The list is absent from the connect snapshot; the Smith store loads it and
  // then follows `smith.updated` / `smith.removed`.
  return class extends Base {
    async listSmiths(): Promise<Smith[]> {
      const result = await this.request("smiths.list", {});
      const smiths = (result as { smiths?: Smith[] })?.smiths;
      return Array.isArray(smiths) ? smiths : [];
    }

    /** The soul, charter and voice presets a new Smith starts from. */
    async smithDefaults(name?: string): Promise<SmithDefaults> {
      return (await this.request("smiths.defaults", { name: name ?? null })) as SmithDefaults;
    }

    async getSmith(id: string): Promise<SmithDetail> {
      return (await this.request("smiths.get", { id })) as SmithDetail;
    }

    async createSmith(input: SmithInput): Promise<SmithDetail> {
      return (await this.request("smiths.create", wireFields(input))) as SmithDetail;
    }

    async updateSmith(id: string, patch: SmithPatch): Promise<SmithDetail> {
      return (await this.request("smiths.update", { id, patch: wireFields(patch) })) as SmithDetail;
    }

    async setSmithPaused(id: string, paused: boolean): Promise<Smith> {
      return (await this.request("smiths.setPaused", { id, paused })) as Smith;
    }

    async deleteSmith(id: string): Promise<void> {
      await this.request("smiths.delete", { id });
    }

    /** Keep an edit made to the identity files outside Warpforge. */
    async acceptSmithIdentity(id: string): Promise<SmithDetail> {
      return (await this.request("smiths.acceptIdentity", { id })) as SmithDetail;
    }

    /** Throw away an edit made to the identity files outside Warpforge. */
    async revertSmithIdentity(id: string): Promise<SmithDetail> {
      return (await this.request("smiths.revertIdentity", { id })) as SmithDetail;
    }

    /** Start a work session as the Smith. @returns the new task's id */
    async startSmithWork(
      id: string,
      work: {
        project: string;
        brief: string;
        backlogItemId?: string | null;
        /** In an isolated worktree; the daemon's default (yes) when absent. */
        worktree?: boolean;
        /** As an orchestrator lead that spawns plain workers. */
        orchestrator?: boolean;
      },
    ): Promise<string> {
      const result = await this.request("smiths.startWork", {
        backlog_item_id: work.backlogItemId ?? null,
        brief: work.brief,
        id,
        project: work.project,
        ...(work.worktree === undefined ? {} : { worktree: work.worktree }),
        ...(work.orchestrator ? { orchestrator: true } : {}),
      });
      return (result as { taskId: string }).taskId;
    }
  };
}
