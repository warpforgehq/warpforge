import type { UiSlice } from "./types";

export const notificationDefaults = {
  taskFinishedToast: false,
  attentionToast: true,
  permissionToast: true,
  nativeTaskFinished: false,
};

export const confirmationDefaults = {
  deleteTask: true,
  archiveTask: false,
  closeTerminal: true,
};

export interface PickerPreferences {
  defaultAgent: string | null;
  defaultModel: string | null;
  hiddenAgents: string[];
  hiddenModels: Record<string, string[]>;
  customModels: Record<string, string[]>;
}

export const devicePreferenceDefaults = {
  notifications: notificationDefaults,
  confirmations: confirmationDefaults,
  pickers: {
    defaultAgent: null,
    defaultModel: null,
    hiddenAgents: [],
    hiddenModels: {},
    customModels: {},
  } as PickerPreferences,
};

export interface DevicePreferences {
  notifications: typeof notificationDefaults;
  confirmations: typeof confirmationDefaults;
  pickers: PickerPreferences;
  setNotification: (key: keyof typeof notificationDefaults, enabled: boolean) => void;
  setConfirmation: (key: keyof typeof confirmationDefaults, enabled: boolean) => void;
  setDefaultAgent: (agent: string | null) => void;
  setDefaultModel: (model: string | null) => void;
  setAgentHidden: (agent: string, hidden: boolean) => void;
  setModelHidden: (agent: string, model: string, hidden: boolean) => void;
  setCustomModel: (agent: string, model: string, present: boolean) => void;
}

export function agentModelIds(byAgent: Record<string, string[]>, agent: string): string[] {
  const ids = byAgent[agent];
  return Array.isArray(ids) ? ids : [];
}

function setMembership(values: string[], value: string, present: boolean): string[] {
  return present ? [...new Set([...values, value])] : values.filter((entry) => entry !== value);
}

export const createDevicePreferences: UiSlice<DevicePreferences> = (set) => ({
  ...devicePreferenceDefaults,
  setNotification: (key, enabled) =>
    set(({ notifications }) => ({ notifications: { ...notifications, [key]: enabled } })),
  setConfirmation: (key, enabled) =>
    set(({ confirmations }) => ({ confirmations: { ...confirmations, [key]: enabled } })),
  setDefaultAgent: (defaultAgent) =>
    set(({ pickers }) => ({ pickers: { ...pickers, defaultAgent, defaultModel: null } })),
  setDefaultModel: (defaultModel) =>
    set(({ pickers }) => ({ pickers: { ...pickers, defaultModel } })),
  setAgentHidden: (agent, hidden) =>
    set(({ pickers }) => ({
      pickers: { ...pickers, hiddenAgents: setMembership(pickers.hiddenAgents, agent, hidden) },
    })),
  setModelHidden: (agent, model, hidden) =>
    set(({ pickers }) => ({
      pickers: {
        ...pickers,
        hiddenModels: {
          ...pickers.hiddenModels,
          [agent]: setMembership(agentModelIds(pickers.hiddenModels, agent), model, hidden),
        },
      },
    })),
  setCustomModel: (agent, id, present) => {
    const model = id.trim();
    if (!model) return;
    set(({ pickers }) => ({
      pickers: {
        ...pickers,
        customModels: {
          ...pickers.customModels,
          [agent]: setMembership(agentModelIds(pickers.customModels, agent), model, present),
        },
        hiddenModels: present
          ? pickers.hiddenModels
          : {
              ...pickers.hiddenModels,
              [agent]: setMembership(agentModelIds(pickers.hiddenModels, agent), model, false),
            },
      },
    }));
  },
});
