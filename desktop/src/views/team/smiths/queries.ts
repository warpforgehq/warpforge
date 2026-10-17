import { useQueries, useQuery } from "@tanstack/react-query";

import { daemon } from "@/daemon";
import { smithAssignee } from "@/lib/smiths";
import type { BacklogItem, Smith } from "@/protocol";

/** Board items a page shows per project. */
const ITEMS_PAGE = 50;

export const smithDetailKey = (id: string) => ["smith", id] as const;

/** A Smith with its soul and charter. */
export function useSmithDetail(id: string) {
  return useQuery({ queryFn: () => daemon.getSmith(id), queryKey: smithDetailKey(id) });
}

/**
 * The board items assigned to a Smith, across the projects it may work in.
 * @param smith the Smith
 * @returns open items assigned to it, and whether any project is still loading
 */
export function useSmithItems(smith: Smith): { items: BacklogItem[]; loading: boolean } {
  const assignee = smithAssignee(smith.id);
  const results = useQueries({
    queries: smith.allowedProjects.map((project) => ({
      queryFn: () => daemon.listBacklog({ assignee, page: 1, pageSize: ITEMS_PAGE, project }),
      queryKey: ["backlog", project, "assignee", assignee],
    })),
  });
  return {
    // The daemon filters by substring; `smith:sm_1` must not match `smith:sm_12`.
    items: results.flatMap((r) => r.data?.items ?? []).filter((i) => i.assignee === assignee),
    loading: results.some((r) => r.isLoading),
  };
}
