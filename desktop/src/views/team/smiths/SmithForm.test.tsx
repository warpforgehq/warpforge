import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SmithDetail, SmithInput, Snapshot } from "@/protocol";
import { smithFixture } from "@/test/smiths";

const { createSmith, updateSmith } = vi.hoisted(() => ({
  createSmith: vi.fn<(input: SmithInput) => Promise<SmithDetail>>(),
  updateSmith: vi.fn<(id: string, patch: unknown) => Promise<SmithDetail>>(),
}));
vi.mock("@/daemon", () => ({
  daemon: { createSmith, getSmith: vi.fn<() => void>(), updateSmith },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn<() => void>() } }));
vi.mock("./IdentityEditor", () => ({
  IdentityEditor: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { emptySmithForm, smithFormFrom } from "./form";
import { SmithForm } from "./SmithForm";

const snapshot = {
  accounts: [],
  agents: [{ displayName: "Claude", enabled: true, id: "claude", models: [] }],
  projects: [{ name: "demo" }, { name: "api" }],
  tasks: [],
} as unknown as Snapshot;
const ada = smithFixture({ allowedProjects: ["demo"], homeProject: "demo" });

function renderForm(props: Partial<React.ComponentProps<typeof SmithForm>> = {}) {
  const onSaved = vi.fn<(detail: SmithDetail) => void>();
  render(
    <SmithForm
      snapshot={snapshot}
      initial={emptySmithForm({ agent: "claude", project: "demo" })}
      smiths={[ada]}
      onSaved={onSaved}
      onCancel={vi.fn<() => void>()}
      {...props}
    />,
  );
  return { onSaved };
}

describe("SmithForm", () => {
  beforeEach(() => {
    createSmith.mockReset();
    updateSmith.mockReset();
  });

  it("refuses a name that is not one word, or is taken, without calling the daemon", async () => {
    renderForm();
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Grace Hopper");
    await userEvent.click(screen.getByRole("button", { name: "Create smith" }));
    expect(screen.getByRole("alert").textContent).toContain("one word");
    await userEvent.clear(screen.getByRole("textbox", { name: "Name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "ADA");
    await userEvent.click(screen.getByRole("button", { name: "Create smith" }));
    expect(screen.getByRole("alert").textContent).toContain("already");
    expect(createSmith).not.toHaveBeenCalled();
  });

  it("creates a smith with its projects, limits and permissions", async () => {
    const detail: SmithDetail = { charter: "", smith: smithFixture({ name: "Grace" }), soul: "" };
    createSmith.mockResolvedValue(detail);
    const { onSaved } = renderForm();
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Grace");
    await userEvent.click(screen.getByRole("checkbox", { name: "api" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Daily turn limit" }), "30");
    await userEvent.click(screen.getByRole("checkbox", { name: "May open pull requests" }));
    await userEvent.click(screen.getByRole("button", { name: "Create smith" }));
    expect(createSmith).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedProjects: ["demo", "api"],
        budget: { turnsPerDay: 30 },
        homeProject: "demo",
        name: "Grace",
        permissions: { createPr: true, push: false, writePaths: [] },
        soul: undefined,
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(detail);
  });

  it("sends only the soul when only the soul was edited", async () => {
    const detail: SmithDetail = { charter: "habits: []\n", smith: ada, soul: "# Ada\n" };
    updateSmith.mockResolvedValue(detail);
    renderForm({ editing: ada, initial: smithFormFrom(detail) });
    await userEvent.type(screen.getByRole("textbox", { name: "Soul" }), "Be terse.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(updateSmith).toHaveBeenCalledWith("sm_1", { soul: "# Ada\nBe terse." });
  });
});
