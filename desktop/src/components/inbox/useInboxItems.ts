import * as React from "react";

import { useInboxPulls } from "@/hooks/useInboxUnseen";
import { applyInboxFilters, sortInboxItems } from "@/lib/inboxFilters";
import { inboxItemKey, markInboxItemSeen } from "@/lib/inboxSeen";
import type { PullRequestSummary } from "@/protocol";
import { useUi } from "@/store/ui";

/**
 * One reading of the inbox for a project set: the filtered listing and which
 * pull request is being reviewed. Selection and filters live in the store
 * rather than here because the list and the review render in two different
 * columns once the list moves into the sidebar, and both have to agree.
 *
 * @param projects Project names to read pull requests from.
 * @returns The filtered listing, the selected pull request and the actions the
 *   list and the review both need.
 */
export function useInboxItems(projects: readonly string[]) {
  const filters = useUi((s) => s.inboxFilters);
  const setFilters = useUi((s) => s.setInboxFilters);
  const selectedKey = useUi((s) => s.inboxSelectedKey);
  const setSelectedKey = useUi((s) => s.setInboxSelectedKey);

  const listing = useInboxPulls(projects, filters);
  const items = React.useMemo(
    () => sortInboxItems(applyInboxFilters(listing.data ?? [], filters)),
    [listing.data, filters],
  );

  // The pane always shows something reviewable, but landing on the inbox is
  // not the same as having read the top row: seen state moves only when the
  // user picks a row themselves.
  const selected = items.find((pr) => inboxItemKey(pr) === selectedKey) ?? items[0] ?? null;

  const openPull = React.useCallback(
    (pr: PullRequestSummary) => {
      markInboxItemSeen({ key: inboxItemKey(pr), updatedAt: pr.updatedAt });
      setSelectedKey(inboxItemKey(pr));
    },
    [setSelectedKey],
  );

  return { filters, items, listing, openPull, selected, setFilters };
}
