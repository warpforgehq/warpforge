/** A sibling folder a task's agent was given alongside its own project. */
export interface WorkspaceFolderInfo {
  name: string;
  path: string;
  git: boolean;
}

export interface Space {
  id: string;
  name: string;
  members: SpaceMember[];
}

export type SpaceMember =
  | { kind: "project"; name: string }
  | { kind: "folder"; path: string; name: string };

export type SpaceMemberKey = { kind: "project"; name: string } | { kind: "folder"; path: string };
