import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parseUnifiedPatch } from "@/lib/pullDiff";

import { PULL_GROUP_ICON_CLASS } from "./PullFilesChanged";
import { PullFilesRail } from "./PullFilesRail";

function patchFor(path: string) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n");
}

const blocks = parseUnifiedPatch(
  [
    "db/migrations/001_init.sql",
    "src/a.ts",
    "src/a.test.ts",
    ".github/workflows/ci.yml",
    "bun.lock",
    "README.md",
  ]
    .map(patchFor)
    .join("\n"),
);

describe("PullFilesRail group headings", () => {
  beforeEach(() => {
    window.localStorage.setItem("wf-pull-files-view", "groups");
  });

  it("colours each group icon with the overview palette", () => {
    render(
      <PullFilesRail
        blocks={blocks}
        viewed={new Set()}
        activePath={null}
        onSelect={vi.fn<(path: string) => void>()}
        onToggleViewed={vi.fn<(path: string) => void>()}
      />,
    );

    const expected = [
      ["Migrations", PULL_GROUP_ICON_CLASS.migrations],
      ["Implementation", PULL_GROUP_ICON_CLASS.implementation],
      ["Tests", PULL_GROUP_ICON_CLASS.tests],
      ["Config & CI", PULL_GROUP_ICON_CLASS.config],
      ["Generated", PULL_GROUP_ICON_CLASS.generated],
      ["Documentation", PULL_GROUP_ICON_CLASS.docs],
    ] as const;
    for (const [label, colour] of expected) {
      const heading = screen.getByRole("button", { name: new RegExp(`^${label}`) });
      const icons = heading.querySelectorAll("svg");
      expect(icons[1]).toHaveClass(colour);
    }
  });
});
