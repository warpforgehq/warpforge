import type {
  CreateExternalResult,
  ExternalWorkItemPage,
  ImportedWorkItem,
  SyncedExternalItem,
  TrackerLinkInfo,
} from "../protocol";
import type { CoreClient } from "./client";
import type { Constructor } from "./types";

export function WorkItemMethods<TBase extends Constructor<CoreClient>>(Base: TBase) {
  return class extends Base {
    /** Every persisted backlog↔tracker link, to hydrate locally-stored items. */
    async trackerLinks(): Promise<TrackerLinkInfo[]> {
      const result = (await this.request("tracker.links", {})) as {
        links?: TrackerLinkInfo[];
      };
      return result.links ?? [];
    }

    /** Create the external issue backing a backlog item. `itemId` is the
     *  client-generated id the daemon keys its link row on. */
    async createExternalWorkItem(input: {
      itemId: string;
      project: string;
      provider: "github" | "linear";
      title: string;
      body?: string;
    }): Promise<CreateExternalResult> {
      return (await this.request("workItem.createExternal", {
        body: input.body ?? "",
        item_id: input.itemId,
        project: input.project,
        provider: input.provider,
        title: input.title,
      })) as CreateExternalResult;
    }

    /** Pull remote status for linked items. Empty `ids` syncs every link. */
    async syncExternalWorkItems(ids: string[] = []): Promise<SyncedExternalItem[]> {
      const result = (await this.request("workItem.syncExternal", { ids })) as {
        items?: SyncedExternalItem[];
        warning?: string;
        deleted_ids?: string[];
      };
      if (result.warning) {
        const { toast: t } = await import("sonner");
        t.warning(result.warning, { duration: 8000 });
      }
      if (result.deleted_ids?.length) {
        const { toast: t } = await import("sonner");
        t.info(`Removed ${result.deleted_ids.length} deleted issue(s) from backlog`);
      }
      return result.items ?? [];
    }

    /** The project's one tracker pull. A single listing per provider answers
     *  both questions: `items` are issues with no backlog row yet (ids minted and
     *  linked daemon-side), `synced` are tracked ones whose status moved. */
    async importExternalWorkItems(
      project: string,
      provider?: "github" | "linear",
    ): Promise<{ items: ImportedWorkItem[]; synced: SyncedExternalItem[]; warning?: string }> {
      const result = (await this.request("workItem.importExternal", {
        project,
        provider,
      })) as { items?: ImportedWorkItem[]; synced?: SyncedExternalItem[]; warning?: string };
      if (result.warning) {
        const { toast } = await import("sonner");
        toast.warning(result.warning, { duration: 8000 });
      }
      return { items: result.items ?? [], synced: result.synced ?? [], warning: result.warning };
    }

    async listExternalWorkItems(input: {
      project: string;
      provider: "github" | "linear";
      page: number;
      pageSize: number;
      sortBy?: string;
      sortDesc?: boolean;
      search?: string;
      status?: string;
    }): Promise<ExternalWorkItemPage> {
      return (await this.request("workItem.list", {
        project: input.project,
        provider: input.provider,
        page: input.page,
        page_size: input.pageSize,
        sort_by: input.sortBy ?? "updatedAt",
        sort_desc: input.sortDesc ?? true,
        search: input.search ?? "",
        status: input.status,
      })) as ExternalWorkItemPage;
    }

    /** Record that a backlog item became this daemon task. */
    async linkWorkItemTask(itemId: string, taskId: string) {
      await this.request("workItem.linkTask", { item_id: itemId, task_id: taskId });
    }
  };
}
