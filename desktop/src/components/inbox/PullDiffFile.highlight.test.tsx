import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import type { PatchFileBlock } from "@/lib/pullDiff";
import { highlightPatchBlock, type PatchHighlight } from "@/lib/pullDiffHighlight";

import { PullDiffFile } from "./PullDiffFile";

vi.mock("@/lib/pullDiffHighlight", () => ({
  highlightPatchBlock: vi.fn<typeof highlightPatchBlock>(),
}));

function block(text: string): PatchFileBlock {
  return {
    path: "same.ts",
    binary: false,
    hunks: [
      {
        id: "0",
        header: "@@ -0,0 +1,1 @@",
        oldStart: 0,
        newStart: 1,
        lines: [{ id: "0:0", kind: "add", newNumber: 1, text }],
      },
    ],
  };
}

it("never shows previous patch tokens while new highlighting is pending or empty", async () => {
  const previous = block("previous commit");
  const next = block("next commit");
  vi.mocked(highlightPatchBlock).mockResolvedValueOnce(
    new Map([["0:0", [{ text: "previous commit", className: "wf-tok-keyword" }]]]),
  );
  let resolve!: (tokens: PatchHighlight) => void;
  vi.mocked(highlightPatchBlock).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = (patch: PatchFileBlock) => (
    <PullDiffFile block={patch} mode="unified" expanded onToggleExpanded={() => {}} />
  );
  const { rerender } = render(view(previous));
  await act(async () => {});
  expect(screen.getByText("previous commit")).toHaveClass("wf-tok-keyword");

  rerender(view(next));
  expect(screen.getByText("next commit")).toBeInTheDocument();
  expect(screen.queryByText("previous commit")).not.toBeInTheDocument();

  await act(async () => {
    resolve(new Map());
  });
  expect(screen.getByText("next commit")).toBeInTheDocument();
  expect(screen.queryByText("previous commit")).not.toBeInTheDocument();
});
