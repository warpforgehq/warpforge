import { describe, expect, it, vi } from "vitest";

import { DaemonClient } from "../daemon";

describe("fetchServiceLogs", () => {
  it("numbers each line from nextSeq and keeps its capture time", async () => {
    const client = new DaemonClient();
    vi.spyOn(client, "request").mockResolvedValue({
      at: [100, 200],
      lines: ["a", "b"],
      nextSeq: 42,
    });
    const entries = await client.fetchServiceLogs("demo", "web");
    expect(entries).toEqual([
      { at: 100, line: "a", seq: 40 },
      { at: 200, line: "b", seq: 41 },
    ]);
    expect(client.getState().serviceLogs["demo/web"]).toEqual(entries);
  });
});
