import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PromptSubmission, TaskInfo, WorkflowRunInfo } from "../protocol";
import { useWorkflowSend } from "./useWorkflowSend";

const workflowReply = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const workflowResume = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const workflowDecide = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

vi.mock("../daemon", () => ({
  daemon: {
    workflowDecide: (...args: unknown[]) => workflowDecide(...(args as [])),
    workflowReply: (...args: unknown[]) => workflowReply(...(args as [])),
    workflowResume: (...args: unknown[]) => workflowResume(...(args as [])),
  },
}));

// Rendered, not called bare: React Compiler output needs a live dispatcher
// (useMemoCache), so the hook has to run inside a real renderer.
function send(box: TaskInfo) {
  return renderHook(() => useWorkflowSend(box), {}).result.current;
}

function task(run: Partial<WorkflowRunInfo> | null): TaskInfo {
  return {
    agent: "claude",
    blockedReason: null,
    createdAt: 1,
    filesChanged: 0,
    id: "t_1",
    project: "warpforge",
    prompt: "do it",
    status: "running",
    tags: [],
    title: "",
    updatedAt: 1,
    workflowRun: run
      ? {
          maxRounds: 2,
          round: 1,
          stage: "review",
          workflowId: "wf",
          workflowName: "Loop",
          ...run,
        }
      : null,
  };
}

const submission = (text: string): PromptSubmission => ({ attachments: [], text });

describe("useWorkflowSend", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declines to handle a plain task so the caller prompts its session", async () => {
    const box = send(task(null));
    expect(box.isWorkflow).toBe(false);
    expect(box.disabled).toBe(false);
    expect(await box.send(submission("hello"))).toBe(false);
  });

  it("routes each barrier to its own RPC", async () => {
    expect(await send(task({ waiting: { kind: "question" } })).send(submission("Postgres"))).toBe(
      true,
    );
    expect(workflowReply).toHaveBeenCalledWith("t_1", "Postgres");

    await send(task({ waiting: { kind: "paused" } })).send(submission("carry on"));
    expect(workflowResume).toHaveBeenCalledWith("t_1", "carry on");

    await send(task({ waiting: { kind: "limit" } })).send(submission("focus here"));
    expect(workflowDecide).toHaveBeenCalledWith("t_1", "extend", {
      note: "focus here",
      rounds: 1,
    });
  });

  it("swallows messages for a session-less parent rather than failing an RPC", async () => {
    // A running or finished pipeline has no addressee; prompting the parent
    // would surface a raw "no live or resumable agent session" error.
    const handled = await Promise.all(
      (["review", "done", "failed"] as const).map((stage) =>
        send(task({ stage, waiting: null })).send(submission("hi")),
      ),
    );
    expect(handled).toEqual([true, true, true]);
    expect(workflowReply).not.toHaveBeenCalled();
    expect(workflowResume).not.toHaveBeenCalled();
    expect(workflowDecide).not.toHaveBeenCalled();
  });

  it("explains why the box is disabled, differently for running vs finished", () => {
    expect(send(task({ stage: "review" })).placeholder).toMatch(/open a stage above/);
    expect(send(task({ stage: "done" })).placeholder).toMatch(/has finished/);
    expect(send(task({ waiting: { kind: "question" } })).placeholder).toMatch(/Answer the stage/);
  });
});
