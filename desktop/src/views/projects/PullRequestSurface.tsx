import { InboxPane } from "@/components/inbox/InboxPane";

/**
 * One project's pull requests, living on the project page's surface bar.
 * Same pane the cross-project inbox uses, pointed at a single project — the
 * count chip on the tab comes from the same query these rows render.
 */
export function PullRequestSurface({
  project,
  onSendToAgent,
}: {
  project: string;
  onSendToAgent?: (project: string, prompt: string) => void;
}) {
  return (
    <InboxPane
      projects={[project]}
      onSendToAgent={onSendToAgent}
      emptyHint="No open pull requests in this project."
    />
  );
}
