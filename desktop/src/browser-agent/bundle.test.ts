import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("browser agent bundle", () => {
  it("is rebuilt from src/browser-agent by bun run build:agent-script", () => {
    const built = spawnSync("bun", ["scripts/build-agent-script.mjs", "--stdout"], {
      encoding: "utf8",
    });
    expect(built.status).toBe(0);
    const committed = readFileSync("src-tauri/src/browser_agent.js", "utf8");
    expect(committed).toContain("if (!window.__wfAgent)");
    expect(committed).toContain("Object.freeze(run)");
    if (built.stdout !== committed) {
      throw new Error("the committed browser_agent.js is stale; run bun run build:agent-script");
    }
  });
});
