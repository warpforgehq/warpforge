import type { BacklogItem, BacklogPage, BacklogSettings, BacklogStorageMode } from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function BacklogMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  return class extends Base {
    async backlogSettings(): Promise<BacklogSettings> {
      return (await this.request("backlog.getSettings", {})) as BacklogSettings;
    }

    async setBacklogStorage(mode: BacklogStorageMode): Promise<BacklogSettings> {
      return (await this.request("backlog.setStorage", { mode })) as BacklogSettings;
    }

    async listBacklog(input: {
      project: string;
      page: number;
      pageSize: number;
      sortBy?: string;
      sortDesc?: boolean;
      search?: string;
      status?: string;
      source?: string;
      priority?: string;
      assignee?: string;
    }): Promise<BacklogPage> {
      return (await this.request("backlog.list", {
        project: input.project,
        page: input.page,
        page_size: input.pageSize,
        sort_by: input.sortBy ?? "updatedAt",
        sort_desc: input.sortDesc ?? true,
        search: input.search ?? "",
        status: input.status,
        source: input.source,
        priority: input.priority,
        assignee: input.assignee,
      })) as BacklogPage;
    }

    async createBacklog(input: {
      project: string;
      title: string;
      body?: string;
      status?: string;
      priority?: string;
      source?: string;
      assignee?: string | null;
    }): Promise<BacklogItem> {
      return (await this.request("backlog.create", {
        project: input.project,
        title: input.title,
        body: input.body ?? "",
        status: input.status ?? "todo",
        priority: input.priority ?? "none",
        source: input.source ?? "local",
        assignee: input.assignee,
      })) as BacklogItem;
    }

    /**
     * Edit an item's own fields. Omitted fields are left as they are, so an
     * assignee is cleared by sending `""` — `null` reads as "leave alone" by the
     * time it reaches the daemon, not as "unassign".
     */
    async updateBacklog(input: {
      itemId: string;
      project: string;
      title?: string;
      body?: string;
      status?: string;
      priority?: string;
      assignee?: string;
    }): Promise<BacklogItem> {
      return (await this.request("backlog.update", {
        item_id: input.itemId,
        project: input.project,
        title: input.title,
        body: input.body,
        status: input.status,
        priority: input.priority,
        assignee: input.assignee,
      })) as BacklogItem;
    }

    async attachBacklogExternal(input: {
      itemId: string;
      project: string;
      provider: "github" | "linear";
      externalId: string;
      url: string;
      remoteStatus?: string | null;
    }): Promise<void> {
      await this.request("backlog.attachExternal", {
        item_id: input.itemId,
        project: input.project,
        provider: input.provider,
        external_id: input.externalId,
        url: input.url,
        remote_status: input.remoteStatus,
      });
    }

    /** Delete a backlog item and its tracker link (rollback for a failed
     *  external create, so a remote-tracking item never claims a tracker it did
     *  not reach). */
    async deleteBacklog(itemId: string, project: string): Promise<void> {
      await this.request("backlog.delete", { item_id: itemId, project });
    }
  };
}
