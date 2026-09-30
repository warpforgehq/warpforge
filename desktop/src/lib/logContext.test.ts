import { describe, expect, it } from "vitest";

import { logContextChip } from "./logContext";

describe("logContextChip", () => {
  it("points a port-forward chip at its own log tool and clamps the cursor at 0", () => {
    const chip = logContextChip("portforward", "db", [{ at: 0, line: "forwarding", seq: 3 }]);
    expect(chip.label).toBe("portforward:db seq 3");
    expect(chip.body).toBe(
      [
        "portforward:db seq 3",
        "```",
        "forwarding",
        "```",
        'Surrounding lines: read_portforward_logs(name: "db", after: 0, before: 24)',
      ].join("\n"),
    );
  });

  it("spells out both dates when the range crosses midnight", () => {
    const chip = logContextChip("service", "api", [
      { at: Date.UTC(2026, 8, 29, 23, 59, 58), line: "a", seq: 10 },
      { at: Date.UTC(2026, 8, 30, 0, 0, 2), line: "b", seq: 11 },
    ]);
    expect(chip.body.split("\n")[0]).toBe(
      "service:api seq 10–11 (2026-09-29 23:59:58–2026-09-30 00:00:02 UTC)",
    );
  });
});
