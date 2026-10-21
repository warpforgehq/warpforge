import { useCallback, useMemo } from "react";

import { parseFileLocation } from "@/lib/fileLocation";

import type { FileDiff, ProjectFile } from "../../protocol";

/**
 * Turns a path an agent wrote in chat into a project-relative path, or null
 * when it names nothing the task knows: absolute paths under the checkout,
 * tracked and untracked files, the diff's files and the open tabs. Gitignored
 * files resolve only by absolute path.
 */
export function useSessionFilePath({
  projectRoot,
  trackedFiles,
  diffFiles,
  openTabs,
}: {
  projectRoot: string | undefined;
  trackedFiles: readonly ProjectFile[];
  diffFiles: readonly FileDiff[] | undefined;
  openTabs: readonly string[];
}) {
  const knownFilePaths = useMemo(() => {
    const paths = new Set<string>();
    for (const file of trackedFiles) paths.add(file.path);
    for (const file of diffFiles ?? []) paths.add(file.path);
    for (const path of openTabs) paths.add(path);
    return paths;
  }, [diffFiles, openTabs, trackedFiles]);

  return useCallback(
    (value: string): string | null => {
      const stripped = value.trim().replace(/^['"`]+|['"`]+$/g, "");
      let path = parseFileLocation(stripped).path;
      path = path.replace(/[),;]+$/, "");
      path = path.replace(/^\.\/+/, "");

      if (projectRoot && path.startsWith(`${projectRoot}/`)) {
        return path.slice(projectRoot.length + 1);
      }

      if (knownFilePaths.has(path)) {
        return path;
      }

      return null;
    },
    [knownFilePaths, projectRoot],
  );
}
