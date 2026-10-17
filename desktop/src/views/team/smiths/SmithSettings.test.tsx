import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SmithDefaults, SmithDetail, Snapshot } from "@/protocol";
import { setSmiths, smithFixture } from "@/test/smiths";

const daemonMock = vi.hoisted(() => ({
  getSmith: vi.fn<(id: string) => Promise<SmithDetail>>(),
  smithDefaults: vi.fn<() => Promise<SmithDefaults>>(),
  updateSmith: vi.fn<(id: string, patch: unknown) => Promise<SmithDetail>>(),
}));
vi.mock("@/daemon", () => ({ daemon: daemonMock }));
vi.mock("sonner", () => ({ toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() } }));
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

import { SmithSettings } from "./SmithSettings";

const ada = smithFixture({ injection: "prefix" });
const detail: SmithDetail = {
  charter: "habits: []\n",
  smith: ada,
  soul: "# Ada\n\n## Voice\n\nPlain and direct.\n\n## Refusals\n\n- None.\n",
};
const snapshot = {
  accounts: [],
  agents: [{ displayName: "Claude", enabled: true, id: "claude", models: [] }],
  projects: [{ name: "warpforge" }, { name: "api" }],
  tasks: [],
} as unknown as Snapshot;

function show() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SmithSettings smithId="sm_1" snapshot={snapshot} />
    </QueryClientProvider>,
  );
}

describe("SmithSettings", () => {
  beforeEach(() => {
    setSmiths([ada]);
    daemonMock.getSmith.mockResolvedValue(detail);
    daemonMock.updateSmith.mockReset();
    daemonMock.smithDefaults.mockResolvedValue({
      charter: "habits: []\n",
      presets: [
        { description: "", id: "plain", label: "Plain", voice: "Plain and direct." },
        { description: "", id: "careful", label: "Careful", voice: "Careful and thorough." },
      ],
      soul: "# Smith\n\n## Voice\n\nPlain and direct.\n",
    });
  });

  it("applies a voice preset to the soul and saves only the soul", async () => {
    daemonMock.updateSmith.mockResolvedValue(detail);
    show();
    await userEvent.click(await screen.findByRole("button", { name: "Careful" }));
    const soul = screen.getByRole("textbox", { name: "Soul" }) as HTMLTextAreaElement;
    expect(soul.value).toContain("Careful and thorough.");
    expect(soul.value).toContain("- None.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(daemonMock.updateSmith).toHaveBeenCalledWith("sm_1", {
      soul: detail.soul.replace("Plain and direct.", "Careful and thorough."),
    });
  });

  it("adds a write path as a chip and saves the permissions alone", async () => {
    daemonMock.updateSmith.mockResolvedValue(detail);
    show();
    await userEvent.type(await screen.findByRole("textbox", { name: "Add a path" }), "src/{Enter}");
    await userEvent.click(screen.getByRole("switch", { name: "May push" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(daemonMock.updateSmith).toHaveBeenCalledWith("sm_1", {
      permissions: { createPr: false, push: true, writePaths: ["src/"] },
    });
  });

  it("refuses a bad limit and moves the delivery note into Model & account", async () => {
    show();
    await userEvent.type(await screen.findByRole("textbox", { name: "Turns per day" }), "1.5");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toContain("whole number");
    expect(daemonMock.updateSmith).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Model & account" }).textContent).toContain(
      "opening message",
    );
  });
});
