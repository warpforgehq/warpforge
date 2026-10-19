/**
 * The scenes as the landing page lists them. Kept free of app imports so the
 * page around the frame can read it at build time.
 */
export const SCENE_META = [
  {
    caption: "One task, delegated across agents, one diff to review.",
    id: "orchestrate",
    label: "Orchestrate",
  },
] as const;

export type SceneId = (typeof SCENE_META)[number]["id"];
