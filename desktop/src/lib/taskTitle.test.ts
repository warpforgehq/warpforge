import { afterEach, describe, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import type { TaskInfo } from "@/protocol";

import { generatedTitle, regenerateTaskTitle } from "./taskTitle";

afterEach(() => vi.restoreAllMocks());

describe("task titles", () => {
  it("keeps the first line of an answer and drops a code fence", () => {
    expect(generatedTitle("```text\nFix the header\nmore\n```")).toBe("Fix the header");
    expect(generatedTitle("  Short  ")).toBe("Short");
  });

  it("regenerates with the task's agent and selected model", async () => {
    const generateText = vi.spyOn(daemon, "generateText").mockResolvedValue("  Regenerated\n");
    const setTaskTitle = vi.spyOn(daemon, "setTaskTitle").mockResolvedValue();
    const task = {
      id: "task-1",
      agent: "codex",
      configOptions: [
        { category: "model", currentValue: "gpt-5", id: "model", name: "Model", options: [] },
      ],
    } as unknown as TaskInfo;

    await regenerateTaskTitle(task);

    expect(generateText).toHaveBeenCalledWith("task-1", "codex", "task_title", "gpt-5");
    expect(setTaskTitle).toHaveBeenCalledWith("task-1", "Regenerated");
  });
});
