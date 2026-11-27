import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { daemon } from "@/daemon";
import { DaemonRpcError } from "@/daemon/rpcError";
import type { ReadProjectConfigResult, ServiceInfo } from "@/protocol";

import { ProjectConfigSurface } from "./ProjectConfigSurface";

const SHARED = `# Team services
services:
  api:
    command: bun run dev # dev server
    port: 3000
custom: keep-me
`;

function read(shared = SHARED, fingerprint = "fp1"): ReadProjectConfigResult {
  return {
    configError: null,
    effective: {
      agentTemplates: {},
      linked: [],
      localFields: [],
      name: "demo",
      portforwards: [],
      ports: null,
      services: {},
      worktree: null,
    },
    local: {
      exists: false,
      fingerprint: null,
      path: "/p/.warpforge/workspace.local.yaml",
      text: "",
    },
    localConfigError: null,
    shared: { exists: true, fingerprint, path: "/p/.warpforge/workspace.yaml", text: shared },
  };
}

function renderPage(services: ServiceInfo[] = []) {
  return render(<ProjectConfigSurface project="demo" rootPath="/p" services={services} />);
}

async function expandApi() {
  fireEvent.click(await screen.findByRole("button", { expanded: false, name: /api/ }));
}

function commit(label: string, value: string) {
  const input = screen.getByLabelText(label);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

let write: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(daemon, "readProjectConfig").mockResolvedValue(read());
  write = vi.spyOn(daemon, "writeProjectConfig").mockResolvedValue({ fingerprint: "fp2" });
});

it("lists services from the config file", async () => {
  renderPage();
  expect(await screen.findByText("api")).toBeInTheDocument();
  expect(screen.getByText("bun run dev")).toBeInTheDocument();
  expect(screen.getByText(".warpforge/workspace.yaml")).toBeInTheDocument();
});

it("saves the edited text with comments intact and the file's fingerprint", async () => {
  renderPage();
  await expandApi();
  commit("Port", "3001");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  const params = write.mock.calls[0]![0];
  expect(params).toMatchObject({ base: "fp1", project: "demo", scope: "shared" });
  expect(params.text).toContain("# Team services");
  expect(params.text).toContain("command: bun run dev # dev server");
  expect(params.text).toContain("custom: keep-me");
  expect(params.text).toContain("port: 3001");
});

it("saves a new env variable to Only me by default", async () => {
  renderPage();
  await expandApi();
  fireEvent.change(screen.getByLabelText("New variable name"), { target: { value: "DEBUG" } });
  fireEvent.change(screen.getByLabelText("New variable value"), { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Add variable" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  expect(write).toHaveBeenCalledWith({
    base: null,
    project: "demo",
    scope: "local",
    text: 'services:\n  api:\n    env:\n      DEBUG: "1"\n',
  });
});

it("warns before saving a secret-looking key to the shared file", async () => {
  renderPage();
  await expandApi();
  fireEvent.change(screen.getByLabelText("New variable name"), { target: { value: "API_TOKEN" } });
  fireEvent.change(screen.getByLabelText("New variable value"), { target: { value: "s3cret" } });
  const scope = screen.getByRole("radiogroup", { name: "Save new variable to" });
  fireEvent.click(within(scope).getByRole("radio", { name: "Shared" }));
  fireEvent.click(screen.getByRole("button", { name: "Add variable" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Save secrets to the shared file?")).toBeInTheDocument();
  expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save to shared" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  expect(write.mock.calls[0]![0]).toMatchObject({ scope: "shared" });
});

it("shows both values when the file changed under an edit, and keeps mine on request", async () => {
  renderPage();
  await expandApi();
  commit("Port", "3001");
  vi.mocked(daemon.readProjectConfig).mockResolvedValue(
    read(SHARED.replace("port: 3000", "port: 4000"), "fp9"),
  );
  write.mockRejectedValueOnce(new DaemonRpcError("config_changed", "changed"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByText("Changed on disk while you were editing")).toBeInTheDocument();
  expect(screen.getByText("4000")).toBeInTheDocument();
  expect(screen.getByText("3001")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
  expect(write.mock.calls[1]![0]).toMatchObject({ base: "fp9" });
  expect(write.mock.calls[1]![0].text).toContain("port: 3001");
});

it("turns read-only with the location while the file does not parse", async () => {
  vi.mocked(daemon.readProjectConfig).mockResolvedValue({
    ...read(),
    configError: {
      column: 5,
      file: "/p/.warpforge/workspace.yaml",
      line: 3,
      message: "bad indentation",
    },
    effective: { ...read().effective, services: { api: { ...SERVICE, command: "old" } } },
  });
  renderPage();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(".warpforge/workspace.yaml:3:5");
  expect(alert).toHaveTextContent("bad indentation");
  expect(screen.getByText("old")).toBeInTheDocument();
  expect(screen.queryByLabelText("New service name")).not.toBeInTheDocument();
  await expandApi();
  expect(screen.getByLabelText("Command")).toBeDisabled();
});

it("offers a restart when a service runs on old config", async () => {
  const restart = vi.spyOn(daemon, "request").mockResolvedValue(undefined);
  renderPage([
    {
      allocatedPort: 4001,
      command: "bun run dev",
      logSeq: 0,
      name: "api",
      needsRestart: true,
      originalPort: 3000,
      project: "demo",
      status: "running",
    },
  ]);

  expect(await screen.findByText("Restart to apply")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restart" }));
  expect(restart).toHaveBeenCalledWith("service.restart", { project: "demo", service: "api" });
});

const SERVICE = {
  command: "",
  dependsOn: [],
  env: null,
  healthcheck: null,
  port: null,
  portFallback: null,
  readyPattern: null,
  readyTimeout: null,
};
