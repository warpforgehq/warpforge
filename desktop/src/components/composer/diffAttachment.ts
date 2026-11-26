import type { FileDiff } from "../../protocol";
import type { ComposerAttachment } from "../Composer";

function countLines(file: FileDiff, prefix: string): number {
  return file.hunks.reduce((sum, h) => sum + h.lines.filter((l) => l.startsWith(prefix)).length, 0);
}

export function diffAttachment(file: FileDiff, formattedContent: string): ComposerAttachment {
  return {
    id: `${file.path}#${Date.now()}`,
    filePath:
      file.status === "renamed" && file.oldPath ? `${file.oldPath} → ${file.path}` : file.path,
    status: file.status,
    content: formattedContent,
    addedLines: countLines(file, "+"),
    removedLines: countLines(file, "-"),
  };
}
