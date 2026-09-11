import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { FileDoc } from "../../protocol";
import type { SaveStatus } from "./constants";

export function useEditorSave({
  viewRef,
  doc,
  onSave,
}: {
  viewRef: RefObject<EditorView | null>;
  doc: FileDoc;
  onSave: (content: string) => void;
}) {
  const lastSaved = useRef<string | null>(null);
  const onSaveRef = useRef(onSave);
  const [status, setStatus] = useState<SaveStatus>("clean");
  const [text, setText] = useState(doc.newText);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const saveCurrent = useCallback((current: string) => {
    lastSaved.current = current;
    setText(current);
    onSaveRef.current(current);
    setStatus("saved");
  }, []);

  const flushSave = useCallback(() => {
    const view = viewRef.current;
    if (!view) {
      return true;
    }
    saveCurrent(view.state.doc.toString());
    return true;
  }, [saveCurrent, viewRef]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (doc.newText === lastSaved.current) {
      return;
    }
    if (status === "clean") {
      const current = view.state.doc.toString();
      if (current === doc.newText) {
        return;
      }
      view.dispatch({
        changes: { from: 0, insert: doc.newText, to: current.length },
      });
      setText(doc.newText);
      lastSaved.current = null;
    }
  }, [doc.newText, status, viewRef]);

  return { status, setStatus, text, setText, lastSaved, onSaveRef, flushSave };
}
