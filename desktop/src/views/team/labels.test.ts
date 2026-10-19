import { describe, expect, it } from "vitest";

import type { PeerMessage, TaskInfo } from "@/protocol";

import { DELETED_LABEL, labeller, shortLabel } from "./labels";

describe("shortLabel", () => {
  it("keeps a short label and cuts a long one", () => {
    expect(shortLabel("Oly")).toBe("Oly");
    const long = "Oly · Test task: git pull, then report TEST-REPORT-OK";
    expect(shortLabel(long)).toBe(`${Array.from(long).slice(0, 27).join("")}…`);
    expect(Array.from(shortLabel(long))).toHaveLength(28);
  });
});

describe("labeller", () => {
  const post = (overrides: Partial<PeerMessage>): PeerMessage => ({
    createdAt: 1,
    id: 1,
    project: "demo",
    status: "delivered",
    text: "x",
    ...overrides,
  });

  it("names a deleted session by the label its records kept", () => {
    const label = labeller(new Map<string, TaskInfo>(), {}, [
      post({
        fromLabel: "Oly · Test task",
        fromTask: "t_06cf5c75",
        toLabel: "Oly",
        toTask: "t_oly",
      }),
    ]);
    expect(label("t_06cf5c75")).toBe("Oly · Test task");
    expect(label("t_oly")).toBe("Oly");
    expect(label("t_unknown")).toBe(DELETED_LABEL);
    expect(label(null)).toBe("You");
  });

  it("prefers the live task, so a rename shows", () => {
    const live = { id: "t_w", prompt: "x", tags: [], title: "Renamed task" } as unknown as TaskInfo;
    const label = labeller(new Map([["t_w", live]]), {}, [
      post({ fromLabel: "Old title", fromTask: "t_w" }),
    ]);
    expect(label("t_w")).toBe("Renamed task");
  });
});
