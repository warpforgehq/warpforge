import { afterEach, describe, expect, it } from "vitest";

import { daemon } from "./index";
import type { DaemonEvent } from "../protocol";

type Internals = {
  applyEvent: (event: DaemonEvent) => void;
  setState: (patch: { sessionUpdates: Record<string, never[]> }) => void;
};
const internals = daemon as unknown as Internals;

function textChunk(taskId: string, text: string): DaemonEvent {
  return {
    data: { task_id: taskId, update: { kind: "agent_text", text } },
    event: "session.update",
  };
}

afterEach(() => {
  internals.setState({ sessionUpdates: {} });
});

describe("session updates", () => {
  it("leaves another task's transcript untouched when one task streams", () => {
    internals.applyEvent(textChunk("t1", "Hello"));
    internals.applyEvent(textChunk("t2", "Other"));
    const before = daemon.getState().sessionUpdates;

    internals.applyEvent(textChunk("t1", "!"));

    const after = daemon.getState().sessionUpdates;
    expect(after.t1).not.toBe(before.t1);
    expect(after.t1).toEqual([{ kind: "agent_text", text: "Hello!" }]);
    // Pinned panes compare their task's slice, so an unrelated chunk must not
    // hand them a new array and re-render the whole wall.
    expect(after.t2).toBe(before.t2);
  });
});
