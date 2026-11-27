import { create } from "zustand";
import { persist } from "zustand/middleware";

import { usePins } from "@/store/pins";

import { createDevicePreferences, devicePreferenceDefaults } from "./devicePreferences";
import { createLayoutSlice } from "./layout";
import { createNavSlice } from "./nav";
import { createProjectNavSlice } from "./projectNav";
import { createSettingsSlice } from "./settings";
import { clampSidebarWidth, SIDEBAR_OPACITY_MIN, type UiState } from "./types";

export const useUi = create<UiState>()(
  persist(
    (...args) => ({
      ...createNavSlice(...args),
      ...createProjectNavSlice(...args),
      ...createLayoutSlice(...args),
      ...createSettingsSlice(...args),
      ...createDevicePreferences(...args),
    }),
    {
      name: "wf-ui",
      version: 15,
      migrate: (persisted: unknown, version: number) => {
        let state = persisted as Record<string, unknown>;
        if (version === 0 && state && "sidebarWidth" in state) {
          if (typeof state.sidebarWidth === "number") {
            state = { ...state, sidebarWidth: clampSidebarWidth(state.sidebarWidth) };
          }
        }
        // The Board view was removed. `view` is persisted, so without this a
        // session that ended there rehydrates a `view` no branch renders.
        if (version < 3 && state && state.view === "board") {
          state = { ...state, view: "start" };
        }
        if (version < 4 && state) {
          // Glass defaults inverted (chrome may be glass, the work surface is
          // solid) and the opacity floor raised — apply both to existing
          // installs, not just new ones.
          const {
            inboxListCollapsed: _inboxListCollapsed,
            pullFilesPanelCollapsed: _pullFilesPanelCollapsed,
            ...rest
          } = state;
          state = { ...rest, bodyGlass: false };
          if (
            typeof state.sidebarOpacity === "number" &&
            state.sidebarOpacity < SIDEBAR_OPACITY_MIN
          ) {
            state = { ...state, sidebarOpacity: SIDEBAR_OPACITY_MIN };
          }
        }
        // The Projects route became a subject. Without a selection there is no
        // project to show, and falling through to the first registered one
        // lands the user on a project they never picked.
        if (version < 5 && state && state.view === "projects") {
          state = { ...state, view: state.selectedProjectId ? "project" : "start" };
        }
        // The Tasks segment returns to the last task. An install upgrading from
        // 5 never stored one, and a task id from storage is only ever offered
        // after the caller finds it in the snapshot.
        if (version < 6 && state) {
          state = { ...state, lastTaskId: null };
        }
        // Glass is the app's look, not just the chrome's: an install that kept
        // the work surface solid read as one opaque block beside translucent
        // panels. The main pane joins the glass for everyone; the Appearance
        // toggle still turns it back off per machine.
        if (version < 7 && state) {
          state = { ...state, bodyGlass: true };
        }
        // The Factory project tab became a task mode; a project that was left
        // on it reopens on its backlog instead of a tab no branch renders.
        if (version < 8 && state && state.projectSurfaceByProject) {
          const surfaces = state.projectSurfaceByProject as Record<string, string>;
          state = {
            ...state,
            projectSurfaceByProject: Object.fromEntries(
              Object.entries(surfaces).filter(([, surface]) => surface !== "factory"),
            ),
          };
        }
        // The Tasks/Inbox tabs became sidebar modes with a stored value; the
        // body used to be read off the route, so the route says which it was.
        if (version < 9 && state) {
          const view = state.view;
          state = { ...state, sidebarMode: view === "inbox" || view === "team" ? view : "tasks" };
        }
        // Smith colours moved to the daemon; the per-device copy is dropped.
        if (version < 10 && state && "smithColors" in state) {
          const { smithColors: _smithColors, ...rest } = state;
          state = rest;
        }
        if (version < 11 && state?.inboxFilters) {
          const filters = state.inboxFilters as Record<string, unknown>;
          state = { ...state, inboxFilters: { ...filters, scope: "review" } };
        }
        if (version < 12) {
          state = { ...devicePreferenceDefaults, ...state };
        }
        if (version < 13) {
          const {
            missionControlTab: _missionControlTab,
            pinnedTaskIds,
            pinnedLayout: _pinnedLayout,
            ...rest
          } = state;
          if (Array.isArray(pinnedTaskIds)) {
            usePins
              .getState()
              .migrateTaskPins(
                pinnedTaskIds.filter((id): id is string => typeof id === "string" && id.length > 0),
              );
          }
          state = {
            ...rest,
            ...(rest.view === "control" && { view: "start" }),
            ...(rest.sidebarMode === "control" && { sidebarMode: "tasks" }),
          };
        }
        // Agents are hidden from pickers by disabling them; the per-device
        // hide list and the separate Models page are gone.
        if (version < 14) {
          const pickers = state.pickers as Record<string, unknown> | undefined;
          if (pickers && "hiddenAgents" in pickers) {
            const { hiddenAgents: _hiddenAgents, ...rest } = pickers;
            state = { ...state, pickers: rest };
          }
          if (state.settingsPage === "models") state = { ...state, settingsPage: "agents" };
        }
        // The project page became the panel's project mode; a session left
        // on a project reopens inside that project's mode.
        if (
          version < 15 &&
          state.view === "project" &&
          typeof state.selectedProjectId === "string"
        ) {
          state = { ...state, panelScope: { kind: "project", name: state.selectedProjectId } };
        }
        return state;
      },
      // OpenTaskId is session-only — a reload shouldn't force-open a stale task.
      // inboxSelectedKey follows it: a reload shouldn't force-open a stale review.
      // activeSurface follows rightPanel: task-scoped, reset by openTask, not persisted.
      // pullFilesPanelCollapsed is re-derived from the room the rail actually
      // has (`useAutoHiddenRail`), so a stored value would only fight it.
      partialize: ({
        openTaskId: _openTaskId,
        openTaskNav: _openTaskNav,
        attentionTargetId: _attentionTargetId,
        attentionTargetNonce: _attentionTargetNonce,
        repositoryOperation: _repositoryOperation,
        rightPanel: _rightPanel,
        activeSurface: _activeSurface,
        pullFilesPanelCollapsed: _pullFilesPanelCollapsed,
        inboxSelectedKey: _inboxSelectedKey,
        teamSelection: _teamSelection,
        selectedAutomationId: _selectedAutomationId,
        newSmithOpen: _newSmithOpen,
        settingsOpen: _settingsOpen,
        settingsTarget: _settingsTarget,
        inboxFilters,
        backlogParamsByProject,
        ...rest
      }) => ({
        ...rest,
        // Same rule as the backlog below: the stance survives a restart, the
        // search term does not.
        inboxFilters: { ...inboxFilters, search: "" },
        // Filters and sort are kept; the search box is not. A term typed days
        // ago would reopen the app on a narrowed list with no visible reason,
        // which reads as "the backlog lost my items".
        backlogParamsByProject: Object.fromEntries(
          Object.entries(backlogParamsByProject).map(([project, params]) => [
            project,
            { ...params, search: "" },
          ]),
        ),
      }),
    },
  ),
);
