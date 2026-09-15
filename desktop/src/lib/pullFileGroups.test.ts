import { describe, expect, it } from "vitest";

import { groupPullFiles, pullFileGroupOf } from "@/lib/pullFileGroups";

describe("pullFileGroupOf", () => {
  it("reads prose, doc folders and datasets as documentation", () => {
    for (const path of [
      "README.md",
      "docs/adr/0010-pull-request-inbox.md",
      "docs/RELEASING.mdx",
      "apps/api/doc/notes.rst",
      "dataset/gold-review-A.jsonl",
      "apps/api/datasets/pilot-words.json",
    ]) {
      expect(`${path} → ${pullFileGroupOf(path)}`).toBe(`${path} → docs`);
    }
  });

  it("reads database migrations whatever the tool", () => {
    for (const path of [
      // Drizzle: the SQL and the meta journal/snapshots beside it.
      "apps/elt-ai/src/db/migrations/0006_glorious_rocket_racer.sql",
      "apps/elt-ai/src/db/migrations/meta/_journal.json",
      "apps/elt-ai/src/db/migrations/meta/0006_snapshot.json",
      "drizzle/0004_add_users.sql",
      // golang-migrate / sqlx up-down pairs.
      "migrations/0003_add_index.up.sql",
      "migrations/0003_add_index.down.sql",
      // Rails and Prisma / Alembic.
      "db/migrate/20240101120000_create_widgets.rb",
      "prisma/migrations/20240101_init/migration.sql",
      "alembic/migrations/versions/ab12_add_column.py",
      // A bare SQL file is a schema change wherever it lives.
      "scripts/seed.sql",
    ]) {
      expect(`${path} → ${pullFileGroupOf(path)}`).toBe(`${path} → migrations`);
    }
  });

  it("reads lockfiles and generated output as generated", () => {
    for (const path of [
      "Cargo.lock",
      "pnpm-lock.yaml",
      "package-lock.json",
      "go.sum",
      "desktop/src/components/__snapshots__/App.snap",
      "apps/api/proto/service_pb2.py",
      "desktop/src/api/generated/client.ts",
      "packages/ui/dist/index.js",
      "web/vendor/alpine.min.js",
    ]) {
      expect(`${path} → ${pullFileGroupOf(path)}`).toBe(`${path} → generated`);
    }
  });

  it("reads tests by convention or by folder", () => {
    for (const path of [
      "desktop/src/lib/pullFileGroups.test.ts",
      "desktop/src/views/Inbox.spec.tsx",
      "internal/store/store_test.go",
      "apps/ai/tests/test_pipeline.py",
      "testdata/gold.json",
    ]) {
      expect(`${path} → ${pullFileGroupOf(path)}`).toBe(`${path} → tests`);
    }
  });

  it("reads CI and infrastructure as config", () => {
    for (const path of [
      ".github/workflows/ci.yml",
      "Dockerfile",
      "deploy/docker-compose.yml",
      "infra/main.tf",
      ".circleci/config.yml",
    ]) {
      expect(`${path} → ${pullFileGroupOf(path)}`).toBe(`${path} → config`);
    }
  });

  it("reads everything else as implementation", () => {
    for (const path of [
      "src/daemon/actor.rs",
      "desktop/src/views/InboxView.tsx",
      "scripts/validate-gold.ts",
      "src/migration_helpers.rs",
      // "documentation" in a file name is not a docs folder, and `_test.rs`
      // is not a Rust test convention (those live under `#[cfg(test)]`).
      "src/documentation_test.rs",
    ]) {
      expect(`${path} → ${pullFileGroupOf(path)}`).toBe(`${path} → implementation`);
    }
  });
});

describe("groupPullFiles", () => {
  it("orders the groups by how much attention they are worth", () => {
    const groups = groupPullFiles([
      { path: "docs/b.md", additions: 30, deletions: 0 },
      { path: "src/a.ts", additions: 10, deletions: 2 },
      { path: "src/nested/c.ts", additions: 5, deletions: 1 },
      { path: "migrations/0001_init.sql", additions: 4, deletions: 0 },
      { path: "src/a.test.ts", additions: 6, deletions: 0 },
      { path: "Cargo.lock", additions: 200, deletions: 3 },
      { path: ".github/workflows/ci.yml", additions: 2, deletions: 1 },
    ]);
    expect(groups.map((group) => group.id)).toEqual([
      "migrations",
      "implementation",
      "tests",
      "config",
      "generated",
      "docs",
    ]);
    // Each group carries its own totals.
    const implementation = groups.find((group) => group.id === "implementation")!;
    expect(implementation.additions).toBe(15);
    expect(implementation.deletions).toBe(3);
    expect(implementation.files.map((file) => file.name)).toEqual(["a.ts", "c.ts"]);
  });

  it("marks the tone of each group and leaves them all folded", () => {
    const groups = groupPullFiles([
      { path: "migrations/0001_init.sql", additions: 1, deletions: 0 },
      { path: "src/a.ts", additions: 1, deletions: 0 },
      { path: "Cargo.lock", additions: 1, deletions: 0 },
      { path: "docs/a.md", additions: 1, deletions: 0 },
    ]);
    const byId = Object.fromEntries(groups.map((group) => [group.id, group]));
    expect(byId.migrations).toMatchObject({ defaultOpen: false, tone: "critical" });
    expect(byId.implementation).toMatchObject({ defaultOpen: false, tone: "normal" });
    expect(byId.generated).toMatchObject({ defaultOpen: false, tone: "noise" });
    expect(byId.docs).toMatchObject({ defaultOpen: false, tone: "normal" });
  });

  it("splits a path into the name it leads with and the directory behind it", () => {
    const [group] = groupPullFiles([
      { path: "apps/api/scripts/types.ts", additions: 1, deletions: 0 },
    ]);
    expect(group.files[0]).toMatchObject({
      dir: "apps/api/scripts",
      name: "types.ts",
      tag: undefined,
    });
  });

  it("notes a dataset file so the row says what it is", () => {
    const groups = groupPullFiles([
      { path: "dataset/gold-review-A.jsonl", additions: 4, deletions: 0 },
      { path: "apps/api/fixtures/words.json", additions: 1, deletions: 0 },
    ]);
    // The note is about the kind of file, not about which group it landed in:
    // a fixture is implementation, and still worth saying "dataset" about.
    for (const group of groups) expect(group.files[0].tag).toBe("dataset");
  });

  it("drops a group with nothing in it", () => {
    const groups = groupPullFiles([{ path: "src/a.ts", additions: 1, deletions: 0 }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe("implementation");
  });
});
