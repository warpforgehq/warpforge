import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { daemon } from "@/daemon";
import { EMPTY_SNAPSHOT, type Snapshot } from "@/protocol";

import { LiveActivityGlyph, ProjectLiveGlyph } from "./LiveActivityGlyph";

const setSnapshot = (patch: Partial<Snapshot>) =>
  act(() =>
    (daemon as unknown as { setState: (patch: { snapshot: Snapshot }) => void }).setState({
      snapshot: { ...EMPTY_SNAPSHOT, ...patch },
    }),
  );

afterEach(() => setSnapshot({}));

describe("LiveActivityGlyph", () => {
  it("draws nothing when nothing is live", () => {
    const { container } = render(<LiveActivityGlyph items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("turns red when any item failed and lists every item", () => {
    const { container } = render(
      <LiveActivityGlyph
        items={[
          { kind: "service", name: "web", scope: "project", state: "running" },
          { kind: "portforward", name: "db", scope: "project", state: "failed" },
        ]}
      />,
    );
    const glyph = container.querySelector("[data-live-activity]");
    expect(glyph).toHaveAttribute("data-live-activity", "failed");
    expect(glyph).toHaveAttribute("title", "Service web · running\nPort-forward db · failed");
    expect(glyph?.querySelector("svg")).toHaveClass("text-destructive");
  });
});

describe("ProjectLiveGlyph", () => {
  it("shows the project's running services", () => {
    setSnapshot({
      services: [
        {
          allocatedPort: 4000,
          command: "bun dev",
          logSeq: 0,
          name: "web",
          originalPort: 3000,
          project: "demo",
          status: "running",
        },
      ],
    });
    const { container } = render(<ProjectLiveGlyph project="demo" />);
    expect(container.querySelector("[data-live-activity]")).toHaveAttribute(
      "title",
      "Service web · running",
    );
  });
});
