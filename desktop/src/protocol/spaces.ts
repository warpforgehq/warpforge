export interface Space {
  id: string;
  name: string;
  members: SpaceMember[];
}

export type SpaceMember =
  | { kind: "project"; name: string }
  | { kind: "folder"; path: string; name: string };

export type SpaceMemberKey = { kind: "project"; name: string } | { kind: "folder"; path: string };
