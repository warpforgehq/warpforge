import { useQuery } from "@tanstack/react-query";

import { daemon } from "@/daemon";
import { useInboxPulls } from "@/hooks/useInboxUnseen";
import type { Snapshot } from "@/protocol";
import type { ProjectSurface } from "@/store/ui";

/** What a running or broken service tells the Runtime row. */
export type RuntimeLight = "failed" | "running" | null;

export interface ProjectSectionStatus {
  counts: Partial<Record<ProjectSurface, number>>;
  runtime: RuntimeLight;
}

/**
 * Counts and the runtime light for a project's section rows.
 * @param project the project name; empty polls nothing
 * @param snapshot the daemon snapshot
 * @returns per-section counts and the runtime light
 */
export function useProjectSectionStatus(project: string, snapshot: Snapshot): ProjectSectionStatus {
  const backlog = useQuery({
    enabled: project.length > 0,
    queryKey: ["backlog", project, "count"],
    queryFn: () =>
      daemon.listBacklog({ project, page: 0, pageSize: 1, sortBy: "updatedAt", sortDesc: true }),
  });
  const pulls = useInboxPulls(project ? [project] : []);
  const services = snapshot.services.filter((service) => service.project === project);
  const terminals = snapshot.terminals.filter((terminal) => terminal.project === project).length;

  return {
    counts: {
      backlog: backlog.data?.total || undefined,
      pulls: pulls.data?.length || undefined,
      terminal: terminals || undefined,
    },
    runtime: services.some((service) => service.status === "failed")
      ? "failed"
      : services.some((service) => service.status === "running")
        ? "running"
        : null,
  };
}
