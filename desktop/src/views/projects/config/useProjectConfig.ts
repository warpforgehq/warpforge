import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { daemon } from "@/daemon";
import { DaemonRpcError } from "@/daemon/rpcError";
import {
  applyOps,
  type ConfigConflict,
  type ConfigOp,
  type ConfigTexts,
  recordOp,
  replayOps,
  touchedScopes,
} from "@/lib/projectConfig/ops";
import { localFieldPaths, mergeConfig, toEffective } from "@/lib/projectConfig/view";
import type { EffectiveProjectConfig, ReadProjectConfigResult } from "@/protocol";

export type ConfigEdit = Omit<ConfigOp, "base">;

export interface SaveError {
  message: string;
  line?: number;
  column?: number;
}

interface State {
  read: ReadProjectConfigResult | null;
  ops: ConfigOp[];
  conflicts: ConfigConflict[];
  loadError: string | null;
  saveError: SaveError | null;
  saving: boolean;
}

const INITIAL: State = {
  conflicts: [],
  loadError: null,
  ops: [],
  read: null,
  saveError: null,
  saving: false,
};

const textsOf = (read: ReadProjectConfigResult): ConfigTexts => ({
  local: read.local.text,
  shared: read.shared.text,
});

function reconcile(prev: State, fresh: ReadProjectConfigResult): State {
  const pending = [...prev.ops, ...prev.conflicts.map((conflict) => conflict.op)];
  const unchanged =
    prev.read?.shared.fingerprint === fresh.shared.fingerprint &&
    prev.read?.local.fingerprint === fresh.local.fingerprint;
  if (unchanged || pending.length === 0) return { ...prev, loadError: null, read: fresh };
  const replay = replayOps(textsOf(fresh), pending);
  return { ...prev, conflicts: replay.conflicts, loadError: null, ops: replay.ops, read: fresh };
}

/**
 * A project's config files as an editable form: pending edits, replay on
 * outside changes, and saves through the daemon.
 * @param project the project name
 * @returns the current view, its state and the edit actions
 */
export function useProjectConfig(project: string) {
  const [state, setState] = useState<State>(INITIAL);
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  const info = useSyncExternalStore(daemon.subscribe, () =>
    daemon.getState().snapshot.projects.find((candidate) => candidate.name === project),
  );

  const refresh = useCallback(async () => {
    try {
      const fresh = await daemon.readProjectConfig(project);
      setState((prev) => reconcile(prev, fresh));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setState((prev) => ({ ...prev, loadError: message }));
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh, info]);

  const docs = useMemo(
    () => (state.read ? applyOps(textsOf(state.read), state.ops) : null),
    [state.read, state.ops],
  );

  const parseError =
    docs && [...docs.shared.errors, ...docs.local.errors].length > 0
      ? (docs.shared.errors[0] ?? docs.local.errors[0])!.message
      : null;
  const readOnly = Boolean(state.read?.configError || state.read?.localConfigError || parseError);

  const view = useMemo((): EffectiveProjectConfig | null => {
    if (!state.read || !docs) return null;
    if (readOnly) return state.read.effective;
    const local = docs.local.toJS();
    return toEffective(
      mergeConfig(docs.shared.toJS(), local),
      state.read.effective.name,
      localFieldPaths(local),
    );
  }, [docs, readOnly, state.read]);

  const edit = useCallback((changes: ConfigEdit[]) => {
    setState((prev) => {
      if (!prev.read) return prev;
      let ops = prev.ops;
      for (const change of changes) ops = recordOp(textsOf(prev.read), ops, change);
      return { ...prev, ops, saveError: null };
    });
  }, []);

  const resolve = useCallback((conflict: ConfigConflict, keep: "mine" | "disk") => {
    setState((prev) => {
      const conflicts = prev.conflicts.filter((candidate) => candidate !== conflict);
      if (keep === "disk" || !prev.read) return { ...prev, conflicts };
      const { base: _base, ...change } = conflict.op;
      return { ...prev, conflicts, ops: recordOp(textsOf(prev.read), prev.ops, change) };
    });
  }, []);

  const discard = useCallback(() => {
    setState((prev) => ({ ...prev, conflicts: [], ops: [], saveError: null }));
  }, []);

  const save = useCallback(async () => {
    setState((prev) => ({ ...prev, saveError: null, saving: true }));
    let { read, ops } = latest.current;
    try {
      for (const scope of touchedScopes(ops)) {
        if (!read) return;
        const text = String(applyOps(textsOf(read), ops)[scope]);
        // Sequential: the daemon validates the local file against the shared one on disk.
        // eslint-disable-next-line no-await-in-loop
        const { fingerprint } = await daemon.writeProjectConfig({
          base: read[scope].fingerprint,
          project,
          scope,
          text,
        });
        const file = { ...read[scope], exists: true, fingerprint, text };
        read = { ...read, [scope]: file };
        ops = ops.filter((op) => op.scope !== scope);
        setState((prev) => ({
          ...prev,
          ops: prev.ops.filter((op) => op.scope !== scope),
          read: prev.read && { ...prev.read, [scope]: file },
        }));
      }
    } catch (cause) {
      if (cause instanceof DaemonRpcError && cause.code === "config_changed") {
        await refresh();
      } else {
        const response = cause instanceof DaemonRpcError ? cause.response : undefined;
        setState((prev) => ({
          ...prev,
          saveError: {
            column: response?.code === "config_invalid" ? response.column : undefined,
            line: response?.code === "config_invalid" ? response.line : undefined,
            message: cause instanceof DaemonRpcError ? cause.detail : String(cause),
          },
        }));
      }
    } finally {
      setState((prev) => ({ ...prev, saving: false }));
    }
  }, [project, refresh]);

  return {
    ...state,
    dirty: state.ops.length > 0 || state.conflicts.length > 0,
    discard,
    docs,
    edit,
    parseError,
    readOnly,
    refresh,
    resolve,
    save,
    view,
  };
}

export type ProjectConfigForm = ReturnType<typeof useProjectConfig>;
