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
  {
    caption: "A backlog item through Factory: implement, review, fix, then a draft PR.",
    id: "factory",
    label: "Factory",
  },
  {
    caption: "A PR comes back with a failing check and a review comment. The task asks for you.",
    id: "pulls",
    label: "Pull requests",
  },
] as const;

export type SceneId = (typeof SCENE_META)[number]["id"];
