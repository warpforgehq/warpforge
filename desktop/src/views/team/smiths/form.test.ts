import { describe, expect, it } from "vitest";

import type { Smith, SmithDetail } from "@/protocol";

import {
  emptySmithForm,
  smithFormFrom,
  smithInputFrom,
  smithPatchFrom,
  validateSmithForm,
} from "./form";

const ada: Smith = {
  agent: "claude",
  allowedProjects: ["demo", "api"],
  budget: { usdPerDay: 5 },
  charterRev: "c1",
  createdAt: 1,
  homeProject: "demo",
  id: "sm_1",
  model: "opus",
  name: "Ada",
  permissions: { createPr: true, push: false, writePaths: ["src/"] },
  soulRev: "s1",
  threadTaskId: "t_thread",
};
const detail: SmithDetail = { charter: "habits: []\n", smith: ada, soul: "# Ada\n" };

describe("validateSmithForm", () => {
  const blank = emptySmithForm({ agent: "claude", project: "demo" });

  it("needs a one-word name nobody else has", () => {
    expect(validateSmithForm({ ...blank, name: "Ada Lovelace" }, []).name).toContain("one word");
    expect(validateSmithForm({ ...blank, name: "ada" }, [ada]).name).toContain("already");
    expect(validateSmithForm({ ...blank, name: "Grace" }, [ada])).toStrictEqual({});
  });

  it("needs a home project and sane limits", () => {
    const errors = validateSmithForm(
      { ...blank, homeProject: "", name: "Grace", turnsPerDay: "1.5", usdPerDay: "-1" },
      [],
    );
    expect(Object.keys(errors).sort()).toStrictEqual(["homeProject", "turnsPerDay", "usdPerDay"]);
  });

  it("refuses tab indentation in the charter", () => {
    expect(
      validateSmithForm({ ...blank, charter: "a:\n\tb: 1", name: "Grace" }, []).charter,
    ).toContain("tabs");
  });
});

describe("smithInputFrom", () => {
  it("keeps the home project first and leaves empty identity to the templates", () => {
    const input = smithInputFrom({
      ...emptySmithForm({ agent: "codex", project: "demo" }),
      allowedProjects: ["api", "demo"],
      name: " Grace ",
      turnsPerDay: "20",
      writePaths: "src/\n\n docs/ ",
    });
    expect(input).toMatchObject({
      allowedProjects: ["demo", "api"],
      budget: { turnsPerDay: 20 },
      charter: undefined,
      name: "Grace",
      permissions: { writePaths: ["src/", "docs/"] },
      soul: undefined,
    });
  });
});

describe("smithPatchFrom", () => {
  it("sends only what changed, and clears a model with an empty string", () => {
    const original = smithFormFrom(detail);
    expect(smithPatchFrom(original, original)).toStrictEqual({});
    const patch = smithPatchFrom({ ...original, model: null, soul: "# Ada, v2\n" }, original);
    expect(patch).toStrictEqual({ model: "", soul: "# Ada, v2\n" });
  });

  it("replaces the budget and permissions as a whole", () => {
    const original = smithFormFrom(detail);
    const patch = smithPatchFrom({ ...original, push: true, usdPerDay: "" }, original);
    expect(patch).toStrictEqual({
      budget: {},
      permissions: { createPr: true, push: true, writePaths: ["src/"] },
    });
  });
});
