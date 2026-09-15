/**
 * The five lazy top-level views. `AppContent` renders them through `lazy()` and
 * re-runs the same loaders on idle once the daemon connects, so the first visit
 * to a route has its chunk already and the Suspense fallback never paints.
 */
export const loadAutomations = () => import("../views/Automations");
export const loadInboxView = () => import("../views/InboxView");
export const loadMissionControl = () => import("../views/MissionControl");
export const loadProjects = () => import("../views/Projects");
export const loadTaskDetail = () => import("../views/TaskDetail");

const ROUTE_LOADERS = [
  loadAutomations,
  loadInboxView,
  loadMissionControl,
  loadProjects,
  loadTaskDetail,
];

export function prefetchRouteChunks(): void {
  for (const load of ROUTE_LOADERS) void load();
}
