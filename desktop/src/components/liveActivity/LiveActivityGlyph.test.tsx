import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { daemon } from "@/daemon";
import { type DaemonEvent, EMPTY_SNAPSHOT, type Snapshot } from "@/protocol";
import { run } from "@/test/keepers";

import { LiveActivityGlyph, ProjectLiveGlyph, TaskLiveGlyph } from "./LiveActivityGlyph";

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

  it("draws a keeper's check grey, not green, so it never reads as passed", () => {
    const keeper = { kind: "keeper", name: "Review", scope: "task", state: "running" } as const;
    const checking = render(<LiveActivityGlyph items={[keeper]} />);
    const icon = checking.container.querySelector("svg");
    expect(icon).toHaveClass("text-muted-foreground");
    expect(icon).not.toHaveClass("text-ok/80");
    checking.unmount();

    const terminal = { kind: "terminal", name: "zsh", scope: "task", state: "running" } as const;
    const { container } = render(<LiveActivityGlyph items={[terminal]} />);
    expect(container.querySelector("svg")).toHaveClass("text-ok/80");
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

describe("TaskLiveGlyph", () => {
  it("follows task.keeper events: green while checking, red when the keeper needs you", () => {
    const apply = (event: DaemonEvent) =>
      act(() => (daemon as unknown as { applyEvent: (e: DaemonEvent) => void }).applyEvent(event));
    const keeperEvent = (
      fields: Partial<Extract<DaemonEvent, { event: "task.keeper" }>["data"]>,
    ): DaemonEvent => ({
      data: {
        findings: [],
        keeper_id: "review",
        run: run({ id: "r1", outcome: null, taskId: "kt" }),
        state: { maxRounds: 3, rounds: 0, status: "idle" },
        task_id: "kt",
        ...fields,
      },
      event: "task.keeper",
    });
    const { container } = render(<TaskLiveGlyph project="demo" taskId="kt" receded={false} />);
    apply(keeperEvent({}));
    const glyph = () => container.querySelector("[data-live-activity]");
    expect(glyph()).toHaveAttribute("data-live-activity", "running");
    expect(glyph()).toHaveAttribute("title", "Keeper Review · checking");

    apply(
      keeperEvent({
        run: run({ count: 2, id: "r1", outcome: "findings", taskId: "kt" }),
        state: { maxRounds: 3, rounds: 3, status: "needs_you", stop: "max_rounds" },
      }),
    );
    expect(glyph()).toHaveAttribute("data-live-activity", "failed");
    expect(glyph()).toHaveAttribute("title", "Keeper Review · needs you");
  });
});
