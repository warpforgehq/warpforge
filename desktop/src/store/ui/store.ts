import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createLayoutSlice } from "./layout";
import { createNavSlice } from "./nav";
import { createPinnedSlice } from "./pinned";
import { createSettingsSlice } from "./settings";
import { clampSidebarWidth, SIDEBAR_OPACITY_MIN, type UiState } from "./types";

export const useUi = create<UiState>()(
  persist(
    (...args) => ({
      ...createNavSlice(...args),
      ...createLayoutSlice(...args),
      ...createSettingsSlice(...args),
      ...createPinnedSlice(...args),
    }),
    {
      name: "wf-ui",
      // Next persisted-shape change must bump this to 8.
      version: 7,
      migrate: (persisted: unknown, version: number) => {
        let state = persisted as Record<string, unknown>;
        if (version === 0 && state && "sidebarWidth" in state) {
          if (typeof state.sidebarWidth === "number") {
            state = { ...state, sidebarWidth: clampSidebarWidth(state.sidebarWidth) };
          }
        }
        if (version < 2 && state && !("pinnedLayout" in state)) {
          state = { ...state, pinnedLayout: {} };
        }
        // The Board view was removed. `view` is persisted, so without this a
        // session that ended there rehydrates a `view` no branch renders.
        if (version < 3 && state && state.view === "board") {
          state = { ...state, view: "control" };
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
          state = { ...state, view: state.selectedProjectId ? "project" : "control" };
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
