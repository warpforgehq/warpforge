import type { Compartment } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { useEffect, useState } from "react";
import type { RefObject } from "react";

import { lspDocumentLanguageForPath, lspLanguageForPath } from "@/lib/codemirrorLanguages";
import { acquireLspClient, releaseLspClient } from "@/lib/lspClients";
import { useUi } from "@/store/ui";

import { daemon } from "../../daemon";

export function useLspClient({
  viewRef,
  lspCompartment,
  docPath,
  editable,
  editorReady,
  taskId,
  project,
}: {
  viewRef: RefObject<EditorView | null>;
  lspCompartment: RefObject<Compartment>;
  docPath: string;
  editable: boolean;
  editorReady: boolean;
  taskId: string;
  project?: string;
}) {
  const lspEnabled = useUi((s) => s.lspEnabled);
  const [lspMissing, setLspMissing] = useState<string | null>(null);
  const [lspInstallBusy, setLspInstallBusy] = useState(false);
  const [lspRetry, setLspRetry] = useState(0);

  // Attach a language server to the editor when one is available for this file.
  // Servers are shared per (workspace, language) and spawned lazily by the
  // daemon; disabled files (diffs/history) and the LSP-off toggle skip this.
  useEffect(() => {
    const language = lspLanguageForPath(docPath);
    const documentLanguage = lspDocumentLanguageForPath(docPath);
    if (!editable || !editorReady || !lspEnabled || !language || !documentLanguage) {
      setLspMissing(null);
      return;
    }
    // Need either a task workspace or a project root for LSP
    const canLsp = !!taskId || !!project;
    if (!canLsp) {
      setLspMissing(null);
      return;
    }
    let cancelled = false;
    let detach: (() => void) | null = null;
    void acquireLspClient(taskId, language, project).then((acquired) => {
      if (!acquired) {
        if (!cancelled) setLspMissing(language);
        return;
      }
      const view = viewRef.current;
      if (cancelled || !view) {
        releaseLspClient(acquired.key);
        return;
      }
      setLspMissing(null);
      const uri = `file://${acquired.rootPath}/${docPath}`;
      view.dispatch({
        effects: lspCompartment.current.reconfigure(acquired.client.plugin(uri, documentLanguage)),
      });
      detach = () => {
        viewRef.current?.dispatch({ effects: lspCompartment.current.reconfigure([]) });
        releaseLspClient(acquired.key);
      };
    });
    return () => {
      cancelled = true;
      detach?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPath, editable, editorReady, lspEnabled, taskId, lspRetry]);

  const installLsp = async () => {
    if (!lspMissing) return;
    setLspInstallBusy(true);
    try {
      await daemon.installLanguageServer(lspMissing);
    } finally {
      setLspInstallBusy(false);
    }
    setLspMissing(null);
    setLspRetry((n) => n + 1);
  };

  return { lspMissing, lspInstallBusy, installLsp };
}
