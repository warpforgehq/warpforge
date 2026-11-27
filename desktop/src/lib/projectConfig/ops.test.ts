import { describe, expect, it } from "vitest";

import { applyOps, type ConfigOp, recordOp, replayOps, touchedScopes } from "./ops";

const SHARED = `# Team services
name: demo
services:
  api:
    command: bun run dev # dev server
    port: 3000
custom: keep-me
`;

const texts = (shared = SHARED, local = "") => ({ local, shared });

describe("recordOp", () => {
  it("keeps comments and unknown keys when a value changes", () => {
    const ops = recordOp(texts(), [], {
      path: ["services", "api", "port"],
      scope: "shared",
      value: 3001,
    });
    const out = String(applyOps(texts(), ops).shared);

    expect(out).toContain("# Team services");
    expect(out).toContain("command: bun run dev # dev server");
    expect(out).toContain("custom: keep-me");
    expect(out).toContain("port: 3001");
  });

  it("replaces an earlier op on the same path and keeps the original base", () => {
    let ops = recordOp(texts(), [], {
      path: ["services", "api", "port"],
      scope: "shared",
      value: 1,
    });
    ops = recordOp(texts(), ops, { path: ["services", "api", "port"], scope: "shared", value: 2 });

    expect(ops).toEqual([
      { base: 3000, path: ["services", "api", "port"], scope: "shared", value: 2 },
    ]);
  });

  it("drops the op when the value is put back", () => {
    let ops = recordOp(texts(), [], {
      path: ["services", "api", "port"],
      scope: "shared",
      value: 1,
    });
    ops = recordOp(texts(), ops, {
      path: ["services", "api", "port"],
      scope: "shared",
      value: 3000,
    });

    expect(ops).toEqual([]);
  });

  it("supersedes ops below a removed path", () => {
    let ops = recordOp(texts(), [], {
      path: ["services", "api", "port"],
      scope: "shared",
      value: 1,
    });
    ops = recordOp(texts(), ops, { path: ["services", "api"], remove: true, scope: "shared" });

    expect(ops).toHaveLength(1);
    expect(ops[0]!.base).toEqual({ command: "bun run dev", port: 3000 });
    expect(String(applyOps(texts(), ops).shared)).not.toContain("api:");
  });

  it("creates missing parents in an empty local file and prunes them on delete", () => {
    let ops = recordOp(texts(), [], {
      path: ["services", "api", "env", "TOKEN"],
      scope: "local",
      value: "x",
    });
    expect(String(applyOps(texts(), ops).local)).toBe(
      "services:\n  api:\n    env:\n      TOKEN: x\n",
    );

    ops = recordOp(texts(), ops, {
      path: ["services", "api", "env", "TOKEN"],
      remove: true,
      scope: "local",
    });
    expect(ops).toEqual([]);
  });

  it("fills a key whose value is empty", () => {
    const shared = "services:\n";
    const ops = recordOp(texts(shared), [], {
      path: ["services", "web", "command"],
      scope: "shared",
      value: "vite",
    });
    expect(String(applyOps(texts(shared), ops).shared)).toBe(
      "services:\n  web:\n    command: vite\n",
    );
  });
});

describe("replayOps", () => {
  const edit: ConfigOp = {
    base: 3000,
    path: ["services", "api", "port"],
    scope: "shared",
    value: 3001,
  };

  it("re-applies ops whose path did not change on disk", () => {
    const fresh = SHARED.replace("custom: keep-me", "custom: changed");
    const { ops, conflicts } = replayOps(texts(fresh), [edit]);

    expect(conflicts).toEqual([]);
    const out = String(applyOps(texts(fresh), ops).shared);
    expect(out).toContain("custom: changed");
    expect(out).toContain("port: 3001");
  });

  it("reports a conflict when the same path changed on disk", () => {
    const fresh = SHARED.replace("port: 3000", "port: 4000");
    const { ops, conflicts } = replayOps(texts(fresh), [edit]);

    expect(ops).toEqual([]);
    expect(conflicts).toEqual([{ disk: 4000, op: edit }]);
  });

  it("drops an op the disk already agrees with", () => {
    const fresh = SHARED.replace("port: 3000", "port: 3001");
    expect(replayOps(texts(fresh), [edit])).toEqual({ conflicts: [], ops: [] });
  });
});

it("lists touched scopes shared first", () => {
  const ops: ConfigOp[] = [
    { base: undefined, path: ["a"], scope: "local", value: 1 },
    { base: undefined, path: ["b"], scope: "shared", value: 1 },
  ];
  expect(touchedScopes(ops)).toEqual(["shared", "local"]);
});
