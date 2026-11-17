import { forwardRef, useImperativeHandle, useRef } from "react";

import { PullDiffHunk } from "@/components/inbox/PullDiffHunk";
import type { PatchHunk, PatchLine } from "@/lib/pullDiff";
import type { FileDiff } from "@/protocol";

import { fileAnchor, hunkKey } from "../diffAnchors";
import type { DiffWorkspaceHandle, Props } from "./WorkingWorkspace";

function patchHunks(file: FileDiff): PatchHunk[] {
  return file.hunks.map((hunk, index) => {
    let oldNumber = hunk.oldStart;
    let newNumber = hunk.newStart;
    return {
      id: String(index),
      oldStart: oldNumber,
      newStart: newNumber,
      header: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      lines: hunk.lines.map((text, lineIndex): PatchLine => {
        const kind = text.startsWith("+") ? "add" : text.startsWith("-") ? "del" : "context";
        return {
          id: `${index}:${lineIndex}`,
          kind,
          text: text.slice(1),
          oldNumber: kind === "add" ? undefined : oldNumber++,
          newNumber: kind === "del" ? undefined : newNumber++,
        };
      }),
    };
  });
}

export const CommitWorkspace = forwardRef<DiffWorkspaceHandle, Props>(function CommitWorkspace(
  { diff, diffError, diffView },
  ref,
) {
  const anchors = useRef(new Map<string, HTMLElement>());
  const nonce = useRef(0);
  useImperativeHandle(
    ref,
    () => ({
      explicitScrollNonce: () => nonce.current,
      scrollToFile: (path) => {
        nonce.current++;
        const node = anchors.current.get(path);
        node?.scrollIntoView();
        return Boolean(node);
      },
      scrollToHunk: (path, key) => {
        const index = diff?.files
          .find((f) => f.path === path)
          ?.hunks.findIndex((h) => hunkKey(h) === key);
        const node = index === undefined ? null : anchors.current.get(`${path}#${index}`);
        node?.scrollIntoView();
        return Boolean(node);
      },
    }),
    [diff],
  );
  return (
    <div className="min-h-0 flex-1 overflow-auto" aria-label="Commit patch">
      {diffError && <p role="alert">{diffError}</p>}
      {!diff && !diffError && <p>Loading commit patch…</p>}
      {diff?.files.length === 0 && <p>No file changes in this commit.</p>}
      {diff?.files.map((file) => (
        <section
          key={file.path}
          id={fileAnchor(file.path)}
          ref={(node) => {
            if (node) anchors.current.set(file.path, node);
            else anchors.current.delete(file.path);
          }}
        >
          <div className="sticky top-0 z-10 border-y bg-card p-2 font-mono text-xs">
            {file.path} · {file.status}
          </div>
          {patchHunks(file).map((hunk, index) => (
            <div
              key={hunk.id}
              ref={(node) => {
                if (node) anchors.current.set(`${file.path}#${index}`, node);
                else anchors.current.delete(`${file.path}#${index}`);
              }}
            >
              <PullDiffHunk hunk={hunk} mode={diffView} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
});
