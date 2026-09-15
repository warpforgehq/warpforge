import { FolderGit2 } from "lucide-react";
import * as React from "react";

import { InboxDetailPane } from "@/components/inbox/InboxDetailPane";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Panel, PanelGroup, PanelSeparator } from "@/components/ui/panels";
import { inboxItemKey } from "@/lib/inboxSeen";
import { isTypingTarget } from "@/lib/typingTarget";
import type { PullRequestSummary } from "@/protocol";
import { PANEL_BOUNDS, usePanelSize } from "@/store/panelLayout";

import { InboxListPane } from "./InboxListPane";
import { useInboxItems } from "./useInboxItems";

/**
 * The inbox as one pane: the selected pull request's review, with the list
 * beside it or in the app sidebar. Both inbox hosts — the cross-project view
 * and a project's Pull Requests tab — render this with a different `projects`
 * set, so their behaviours cannot drift.
 *
 * `j`/`k` (and the arrow keys) walk the list without leaving the review, the
 * way every other code-review tool behaves. They live here rather than in the
 * list because the review is the part that is always mounted.
 */
export function InboxPane({
  projects,
  onSendToAgent,
  onAddProject,
  emptyHint,
  listPlacement = "pane",
}: {
  /** Project names to read pull requests from. One project narrows the tab. */
  projects: readonly string[];
  /** Fired by the review pane's "Send to agent" action; the host owns creation. */
  onSendToAgent?: (project: string, prompt: string) => void;
  /** Opens the host's add-project dialog from the "no projects" state. */
  onAddProject?: () => void;
  emptyHint?: string;
  /** Where the "which pull request" list renders. `sidebar` means the app
   *  sidebar is already showing it and this pane is review only. */
  listPlacement?: "pane" | "sidebar";
}) {
  const { items, openPull, selected } = useInboxItems(projects);
  const [listSize, setListSize] = usePanelSize("inboxList");
  const listBounds = PANEL_BOUNDS.inboxList;

  const handleSendToAgent = React.useCallback(
    (pr: PullRequestSummary, prompt: string) => onSendToAgent?.(pr.project, prompt),
    [onSendToAgent],
  );

  // Walk the list from anywhere in the surface. Steps are relative to what is
  // on screen, so a filtered list steps through the filtered rows only.
  React.useEffect(() => {
    if (items.length === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      const step =
        event.key === "j" || event.key === "ArrowDown"
          ? 1
          : event.key === "k" || event.key === "ArrowUp"
            ? -1
            : 0;
      if (step === 0) return;
      event.preventDefault();
      const selectedNow = selected ? inboxItemKey(selected) : "";
      const current = items.findIndex((pr) => inboxItemKey(pr) === selectedNow);
      const next = items[Math.min(items.length - 1, Math.max(0, current + step))];
      if (next) openPull(next);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, openPull, selected]);

  if (projects.length === 0) {
    return (
      <EmptyState
        className="h-full"
        icon={FolderGit2}
        title="No projects yet"
        hint="Add a project to fill the inbox."
        action={
          onAddProject && (
            <Button variant="outline" onClick={onAddProject}>
              <FolderGit2 className="size-4" />
              Add project
            </Button>
          )
        }
      />
    );
  }

  const detail = (
    <InboxDetailPane pr={selected} onSendToAgent={onSendToAgent ? handleSendToAgent : undefined} />
  );

  if (listPlacement === "sidebar") return detail;

  return (
    <PanelGroup orientation="horizontal" className="h-full min-h-0 min-w-0">
      <Panel
        size={listSize}
        minSize={listBounds.min}
        maxSize={listBounds.max}
        defaultSize={listBounds.default}
        onSizeChange={setListSize}
        className="min-w-0"
      >
        <InboxListPane projects={projects} emptyHint={emptyHint} onAddProject={onAddProject} />
      </Panel>
      <PanelSeparator aria-label="Resize pull request list" />
      <Panel pin className="min-w-0">
        {detail}
      </Panel>
    </PanelGroup>
  );
}
