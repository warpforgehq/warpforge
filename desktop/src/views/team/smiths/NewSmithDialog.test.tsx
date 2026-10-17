import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SmithDefaults, SmithDetail, SmithInput, Snapshot } from "@/protocol";
import { useUi } from "@/store/ui";
import { setSmiths, smithFixture } from "@/test/smiths";

const daemonMock = vi.hoisted(() => ({
  createSmith: vi.fn<(input: SmithInput) => Promise<SmithDetail>>(),
  smithDefaults: vi.fn<() => Promise<SmithDefaults>>(),
}));
vi.mock("@/daemon", () => ({ daemon: daemonMock }));
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

import { NewSmithDialog } from "./NewSmithDialog";

const DEFAULTS: SmithDefaults = {
  charter: "habits: []\n",
  presets: [
    { description: "Short.", id: "plain", label: "Plain", voice: "Plain and direct." },
    {
      description: "Checks twice.",
      id: "careful",
      label: "Careful",
      voice: "Careful and thorough.",
    },
  ],
  soul: "# Smith\n\n## Voice\n\nPlain and direct.\n\n## Refusals\n\n- None.\n",
};

const snapshot = {
  accounts: [],
  agents: [{ displayName: "Claude", enabled: true, id: "claude", models: [] }],
  projects: [{ name: "warpforge" }, { name: "api" }],
  tasks: [],
} as unknown as Snapshot;

function show() {
  const onClose = vi.fn<() => void>();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NewSmithDialog snapshot={snapshot} project="api" onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

function soul() {
  return (screen.getByRole("textbox", { name: "Soul" }) as HTMLTextAreaElement).value;
}

describe("NewSmithDialog", () => {
  beforeEach(() => {
    daemonMock.smithDefaults.mockResolvedValue(DEFAULTS);
    daemonMock.createSmith.mockReset();
    setSmiths([smithFixture()]);
    useUi.setState({ smithColors: {}, teamSelection: null });
  });

  it("shows the daemon's real soul, with the name and the picked voice in it", async () => {
    show();
    await screen.findByRole("radio", { name: /Careful/ });
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Grace");
    await userEvent.click(screen.getByRole("button", { name: /Customize/ }));
    expect(soul()).toBe(DEFAULTS.soul.replace("# Smith", "# Grace"));
    await userEvent.click(screen.getByRole("radio", { name: /Careful/ }));
    expect(soul()).toContain("## Voice\n\nCareful and thorough.\n");
    expect(soul()).toContain("## Refusals\n\n- None.");
  });

  it("keeps the user's own soul edits when the personality changes", async () => {
    show();
    await screen.findByRole("radio", { name: /Careful/ });
    await userEvent.click(screen.getByRole("button", { name: /Customize/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Soul" }), "- Jokes a lot.");
    await userEvent.click(screen.getByRole("radio", { name: /Careful/ }));
    expect(soul()).toContain("- Jokes a lot.");
    expect(soul()).toContain("Careful and thorough.");
  });

  it("creates the smith in its project with defaults for everything else", async () => {
    daemonMock.createSmith.mockResolvedValue({
      charter: "",
      smith: smithFixture({ id: "sm_9", name: "Grace" }),
      soul: "",
    });
    const onClose = show();
    await screen.findByRole("radio", { name: /Careful/ });
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Grace");
    await userEvent.click(screen.getByRole("radio", { name: "Colour 3" }));
    await userEvent.click(screen.getByRole("radio", { name: /Careful/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create Grace" }));
    expect(daemonMock.createSmith).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude",
        allowedProjects: ["api"],
        budget: {},
        charter: DEFAULTS.charter,
        homeProject: "api",
        name: "Grace",
        permissions: { createPr: false, push: false, writePaths: [] },
      }),
    );
    expect(daemonMock.createSmith.mock.calls[0]![0].soul).toContain("Careful and thorough.");
    expect(useUi.getState().smithColors).toStrictEqual({ sm_9: 2 });
    expect(useUi.getState().teamSelection).toStrictEqual({ id: "sm_9", kind: "teammate" });
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses a taken name before calling the daemon", async () => {
    show();
    await screen.findByRole("radio", { name: /Careful/ });
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "ada");
    await userEvent.click(screen.getByRole("button", { name: "Create ada" }));
    expect(screen.getByRole("alert").textContent).toContain("already");
    expect(daemonMock.createSmith).not.toHaveBeenCalled();
  });
});
