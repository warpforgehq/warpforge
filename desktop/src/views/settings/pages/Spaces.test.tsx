import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn<() => Promise<string | null>>() }));

import { daemon, type DaemonState } from "@/daemon";
import { EMPTY_SNAPSHOT, type ProjectInfo, type Space } from "@/protocol";
import { usePins } from "@/store/pins";
import { useUi } from "@/store/ui";

import SpacesPage from "./Spaces";

function project(name: string, linked?: string[]): ProjectInfo {
  return {
    declaredServices: [],
    linked,
    name,
    path: `/work/${name}`,
    portRange: [4000, 4099],
  };
}

const payments: Space = {
  id: "s1",
  members: [
    { kind: "project", name: "api" },
    { kind: "folder", name: "schemas", path: "/work/schemas" },
    { kind: "folder", name: "notes", path: "/work/notes" },
  ],
  name: "Payments",
};

beforeEach(() => {
  vi.spyOn(daemon, "subscribe").mockReturnValue(() => {});
  vi.spyOn(daemon, "getState").mockReturnValue({
    snapshot: {
      ...EMPTY_SNAPSHOT,
      projects: [project("api", ["/work/schemas/"]), project("web"), project("core")],
      spaces: [payments, { id: "s2", members: [{ kind: "project", name: "core" }], name: "Core" }],
    },
  } as unknown as DaemonState);
  vi.spyOn(daemon, "createSpace").mockResolvedValue({ id: "s3", members: [], name: "Infra" });
  vi.spyOn(daemon, "addSpaceMember").mockResolvedValue(payments);
  vi.spyOn(daemon, "removeSpaceMember").mockResolvedValue(payments);
});

afterEach(() => {
  vi.restoreAllMocks();
  usePins.setState({ pins: [] });
});

function section(name: string) {
  return screen.getByRole("heading", { name, level: 2 }).closest("section")!;
}

it("creates a space", async () => {
  render(<SpacesPage />);
  await userEvent.type(screen.getByRole("textbox", { name: "Space name" }), "Infra");
  await userEvent.click(screen.getByRole("button", { name: "Create space" }));
  expect(daemon.createSpace).toHaveBeenCalledWith("Infra");
});

it("adds only a project in no space, and a folder by path", async () => {
  render(<SpacesPage />);
  const card = within(section("Payments"));

  const picker = card.getByRole("combobox", { name: "Project to add to Payments" });
  expect(
    within(picker)
      .getAllByRole("option")
      .map((option) => option.textContent),
  ).toEqual(["web"]);
  await userEvent.click(card.getByRole("button", { name: "Add project" }));
  expect(daemon.addSpaceMember).toHaveBeenCalledWith("s1", { kind: "project", name: "web" });

  await userEvent.type(
    card.getByRole("textbox", { name: "Folder path to add to Payments" }),
    "/work/k8s",
  );
  await userEvent.click(card.getByRole("button", { name: "Add folder" }));
  expect(daemon.addSpaceMember).toHaveBeenCalledWith("s1", {
    kind: "folder",
    name: "k8s",
    path: "/work/k8s",
  });
});

it("removes a member", async () => {
  render(<SpacesPage />);
  await userEvent.click(screen.getByRole("button", { name: "Remove notes from Payments" }));
  expect(daemon.removeSpaceMember).toHaveBeenCalledWith("s1", {
    kind: "folder",
    path: "/work/notes",
  });
});

it("marks a member listed in workspace.yaml and says removal won't stick", () => {
  render(<SpacesPage />);
  const card = within(section("Payments"));
  const schemas = card.getByRole("heading", { name: "schemas" }).parentElement!.parentElement!;
  expect(within(schemas).getByText("from workspace.yaml")).toBeInTheDocument();
  expect(
    within(schemas).getByText(/comes back while it is still listed there/),
  ).toBeInTheDocument();
  const notes = card.getByRole("heading", { name: "notes" }).parentElement!.parentElement!;
  expect(within(notes).queryByText("from workspace.yaml")).not.toBeInTheDocument();
});

it("shows the one-space-per-project refusal inline", async () => {
  vi.mocked(daemon.addSpaceMember).mockRejectedValue(
    new Error('Project "web" already belongs to space "Core"'),
  );
  render(<SpacesPage />);
  const card = within(section("Payments"));
  await userEvent.click(card.getByRole("button", { name: "Add project" }));
  expect(await card.findByRole("alert")).toHaveTextContent('already belongs to space "Core"');
});

it("pins a newly created space to the rail", async () => {
  render(<SpacesPage />);
  await userEvent.type(screen.getByRole("textbox", { name: "Space name" }), "Infra");
  await userEvent.click(screen.getByRole("button", { name: "Create space" }));

  expect(usePins.getState().pins).toEqual([{ id: "s3", kind: "space" }]);
});

it("opens a space in the sidebar and closes Settings", async () => {
  useUi.setState({ settingsOpen: true });
  render(<SpacesPage />);

  await userEvent.click(within(section("Payments")).getByRole("button", { name: "Open Payments" }));

  const ui = useUi.getState();
  expect(ui.settingsOpen).toBe(false);
  expect(ui.sidebarMode).toBe("tasks");
  expect(ui.panelScope).toEqual({ kind: "space", id: "s1" });
});

it("pins and unpins a space from its card", async () => {
  render(<SpacesPage />);
  const card = within(section("Payments"));

  await userEvent.click(card.getByRole("button", { name: "Pin Payments to rail" }));
  expect(usePins.getState().pins).toEqual([{ id: "s1", kind: "space" }]);

  await userEvent.click(card.getByRole("button", { name: "Unpin Payments from rail" }));
  expect(usePins.getState().pins).toEqual([]);
});
