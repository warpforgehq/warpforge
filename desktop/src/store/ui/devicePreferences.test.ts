import { afterEach, expect, it } from "vitest";

import { useUi } from "@/store/ui";

const initial = useUi.getInitialState();

afterEach(() => {
  useUi.setState(initial, true);
  localStorage.clear();
});

it("migrates version 11 settings and keeps the last section and theme", async () => {
  localStorage.setItem(
    "wf-ui",
    JSON.stringify({ version: 11, state: { settingsPage: "agents", theme: "paper" } }),
  );
  await useUi.persist.rehydrate();

  expect(useUi.getState()).toMatchObject({
    settingsPage: "agents",
    theme: "paper",
    notifications: {
      taskFinishedToast: false,
      attentionToast: true,
      permissionToast: true,
      nativeTaskFinished: false,
    },
    confirmations: { deleteTask: true, archiveTask: false, closeTerminal: true },
    pickers: {
      defaultAgent: null,
      defaultModel: null,
      hiddenModels: {},
      customModels: {},
    },
  });
  expect(JSON.parse(localStorage.getItem("wf-ui") ?? "{}")).toHaveProperty("version", 14);
});

it("drops the hidden-agents list and the Models page in version 14", async () => {
  localStorage.setItem(
    "wf-ui",
    JSON.stringify({
      version: 13,
      state: {
        settingsPage: "models",
        pickers: { defaultAgent: "codex", hiddenAgents: ["claude"], hiddenModels: {} },
      },
    }),
  );
  await useUi.persist.rehydrate();

  const { pickers, settingsPage } = useUi.getState();
  expect(settingsPage).toBe("agents");
  expect(pickers.defaultAgent).toBe("codex");
  expect(pickers).not.toHaveProperty("hiddenAgents");
});

it("persists preferences without persisting a search target", async () => {
  const state = useUi.getState();
  state.setNotification("taskFinishedToast", true);
  state.setConfirmation("archiveTask", true);
  state.setDefaultAgent("codex");
  state.setDefaultModel("provider/model");
  state.setCustomModel("codex", "provider/model", true);
  state.setSettingsPage("notifications", "task-finished-toast");
  const stored = localStorage.getItem("wf-ui") ?? "";
  expect(JSON.parse(stored)).not.toHaveProperty("state.settingsTarget");

  useUi.setState(initial, true);
  localStorage.setItem("wf-ui", stored);
  await useUi.persist.rehydrate();

  expect(useUi.getState()).toMatchObject({
    settingsPage: "notifications",
    settingsTarget: null,
    notifications: { taskFinishedToast: true },
    confirmations: { archiveTask: true },
    pickers: {
      defaultAgent: "codex",
      defaultModel: "provider/model",
      customModels: { codex: ["provider/model"] },
    },
  });
});
