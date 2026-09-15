import { InboxPane } from "@/components/inbox/InboxPane";
import { useInboxUnseenCount } from "@/hooks/useInboxUnseen";

interface InboxViewProps {
  /** Every registered project's name, from the daemon snapshot. */
  projects: readonly string[];
  onSendToAgent?: (project: string, prompt: string) => void;
  /** Whether the app sidebar is showing the pull-request list. False on a
   *  window too narrow for a sidebar, where the pane carries its own list. */
  listInSidebar: boolean;
}

/**
 * The cross-project inbox: one list over every project's open pull requests,
 * newest update first, with the unread markers the sidebar badge counts.
 * Scoped to one project it becomes the project page's Pull Requests tab —
 * same pane, different `projects` argument.
 */
export default function InboxView({ projects, onSendToAgent, listInSidebar }: InboxViewProps) {
  // The count mirrors the sidebar's badge and costs nothing: same query key,
  // so this is a cache read, not a second poll.
  useInboxUnseenCount(projects);

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
      <InboxPane
        projects={projects}
        onSendToAgent={onSendToAgent}
        emptyHint={projects.length === 0 ? undefined : "No open pull requests in your projects."}
        listPlacement={listInSidebar ? "sidebar" : "pane"}
      />
    </div>
  );
}
