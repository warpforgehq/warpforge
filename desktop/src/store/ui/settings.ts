import { DEFAULT_THEME } from "@/lib/themes";

import {
  BLUR_RADIUS_DEFAULT,
  BLUR_RADIUS_MAX,
  BLUR_RADIUS_MIN,
  SIDEBAR_OPACITY_DEFAULT,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  type SettingsPage,
  type UiSlice,
} from "./types";

const DEFAULT_FONT_SIZE = 14;
const DEFAULT_MONO_FONT_SIZE = 13;
const FONT_SIZE_STEP = 1;
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;
const MONO_FONT_SIZE_MIN = 9;
const MONO_FONT_SIZE_MAX = 22;

function clampFontSize(v: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(v)));
}

function clampMonoFontSize(v: number): number {
  return Math.min(MONO_FONT_SIZE_MAX, Math.max(MONO_FONT_SIZE_MIN, Math.round(v)));
}

export interface SettingsState {
  /** Id of the active color theme. See lib/themes. */
  theme: string;
  setTheme: (id: string) => void;
  fontSize: number;
  monoFontSize: number;
  setFontSize: (size: number) => void;
  setMonoFontSize: (size: number) => void;
  bumpFontSize: (direction: 1 | -1) => void;
  bumpMonoFontSize: (direction: 1 | -1) => void;
  resetFontSizes: () => void;
  /** Harness the PR Assistant talks to. null = first configured one. */
  prAssistantAgentId: string | null;
  setPrAssistantAgentId: (id: string | null) => void;
  /** Model the PR Assistant asks for, per harness. Kept per harness because
   *  the lists have nothing in common — five Anthropic models on one, an
   *  OpenRouter catalogue on the next. */
  prAssistantModelByAgent: Record<string, string>;
  setPrAssistantModel: (agentId: string, model: string) => void;
  /** Agent that drafts commit messages and PR descriptions. null = none picked. */
  textGenAgentId: string | null;
  setTextGenAgentId: (id: string | null) => void;
  /** Model override for that agent. null = whatever the agent defaults to. */
  textGenModel: string | null;
  setTextGenModel: (model: string | null) => void;
  /** When true and a text-gen agent is selected, auto-generate a task title after creation. */
  autoNameTasks: boolean;
  setAutoNameTasks: (v: boolean) => void;
  /** Easter egg: blur email addresses wherever they render. */
  theoMod: boolean;
  setTheoMod: (v: boolean) => void;
  /** Transparent window + native desktop blur. Off by default. */
  transparentWindow: boolean;
  setTransparentWindow: (v: boolean) => void;
  /** How much desktop shows through the chrome surfaces while glass is on. */
  sidebarOpacity: number;
  setSidebarOpacity: (v: number) => void;
  /** Radius of the native blur behind the window. */
  blurRadius: number;
  setBlurRadius: (v: number) => void;
  /** Extend the translucent treatment to the main pane, not just the chrome. */
  bodyGlass: boolean;
  setBodyGlass: (v: boolean) => void;
  /** Last Settings page the user was on — reopening lands where they left. */
  settingsPage: SettingsPage;
  setSettingsPage: (page: SettingsPage) => void;
  /**
   * Whether New Task starts in an isolated git worktree. Persisted so the
   * choice survives across task creations instead of resetting every time.
   * Off by default — most tasks run in the checkout the user is already in.
   */
  newTaskWorktree: boolean;
  setNewTaskWorktree: (v: boolean) => void;
  /**
   * Whether continuing a conversation in a new task puts it in an isolated git
   * worktree. On by default — a fork usually explores an alternative — but
   * persisted so continuing in the current checkout stays a one-time choice.
   */
  branchWorktree: boolean;
  setBranchWorktree: (v: boolean) => void;
  /**
   * Whether the New Work Item dialog opens expanded (tall prompt) or compact.
   * Persisted so the choice survives across creates instead of resetting.
   */
  newWorkItemExpanded: boolean;
  setNewWorkItemExpanded: (v: boolean) => void;
  // Editor: language-server (LSP) features — persisted, user-toggled.
  lspEnabled: boolean;
  toggleLsp: () => void;
}

export const createSettingsSlice: UiSlice<SettingsState> = (set) => ({
  theme: DEFAULT_THEME,
  fontSize: DEFAULT_FONT_SIZE,
  monoFontSize: DEFAULT_MONO_FONT_SIZE,
  prAssistantAgentId: null,
  prAssistantModelByAgent: {},
  textGenAgentId: null,
  textGenModel: null,
  autoNameTasks: true,
  newTaskWorktree: false,
  branchWorktree: true,
  newWorkItemExpanded: false,
  theoMod: false,
  transparentWindow: false,
  sidebarOpacity: SIDEBAR_OPACITY_DEFAULT,
  blurRadius: BLUR_RADIUS_DEFAULT,
  bodyGlass: false,
  lspEnabled: true,
  settingsPage: "appearance",

  // ── Font size settings ──
  setFontSize: (fontSize) => set({ fontSize: clampFontSize(fontSize) }),
  setMonoFontSize: (monoFontSize) => set({ monoFontSize: clampMonoFontSize(monoFontSize) }),
  bumpFontSize: (direction) =>
    set((s) => ({ fontSize: clampFontSize(s.fontSize + direction * FONT_SIZE_STEP) })),
  bumpMonoFontSize: (direction) =>
    set((s) => ({
      monoFontSize: clampMonoFontSize(s.monoFontSize + direction * FONT_SIZE_STEP),
    })),
  resetFontSizes: () =>
    set({ fontSize: DEFAULT_FONT_SIZE, monoFontSize: DEFAULT_MONO_FONT_SIZE }),
  setTheme: (theme) => set({ theme }),
  // Models are per-agent, so a stored pick is meaningless once the agent changes.
  setPrAssistantAgentId: (prAssistantAgentId) => set({ prAssistantAgentId }),
  setPrAssistantModel: (agentId, model) =>
    set((state) => ({
      prAssistantModelByAgent: { ...state.prAssistantModelByAgent, [agentId]: model },
    })),
  setTextGenAgentId: (textGenAgentId) => set({ textGenAgentId, textGenModel: null }),
  setTextGenModel: (textGenModel) => set({ textGenModel }),
  setAutoNameTasks: (autoNameTasks) => set({ autoNameTasks }),
  setNewTaskWorktree: (newTaskWorktree) => set({ newTaskWorktree }),
  setBranchWorktree: (branchWorktree) => set({ branchWorktree }),
  setNewWorkItemExpanded: (newWorkItemExpanded) => set({ newWorkItemExpanded }),
  setTheoMod: (theoMod) => set({ theoMod }),
  setTransparentWindow: (transparentWindow) => set({ transparentWindow }),
  setSidebarOpacity: (v) =>
    set({
      sidebarOpacity: Math.min(SIDEBAR_OPACITY_MAX, Math.max(SIDEBAR_OPACITY_MIN, v)),
    }),
  setBlurRadius: (v) =>
    set({
      blurRadius: Math.min(BLUR_RADIUS_MAX, Math.max(BLUR_RADIUS_MIN, Math.round(v))),
    }),
  setBodyGlass: (bodyGlass) => set({ bodyGlass }),
  setSettingsPage: (settingsPage) => set({ settingsPage }),
  toggleLsp: () => set((s) => ({ lspEnabled: !s.lspEnabled })),
});
