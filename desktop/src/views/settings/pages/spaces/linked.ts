import type { ProjectInfo, Space, SpaceMember } from "@/protocol";

const trim = (path: string) => path.replace(/\/+$/, "");

/**
 * The project whose workspace.yaml lists a member under `linked:`.
 * @param space the space the member is in
 * @param member the member
 * @param projects registered projects with their resolved `linked` paths
 * @returns the declaring project's name, or null for a member added here
 */
export function linkedBy(
  space: Space,
  member: SpaceMember,
  projects: readonly ProjectInfo[],
): string | null {
  const path =
    member.kind === "folder"
      ? member.path
      : projects.find((project) => project.name === member.name)?.path;
  if (!path) return null;
  for (const candidate of space.members) {
    if (candidate.kind !== "project" || candidate === member) continue;
    const declaring = projects.find((project) => project.name === candidate.name);
    if (declaring?.linked?.some((link) => trim(link) === trim(path))) return declaring.name;
  }
  return null;
}
