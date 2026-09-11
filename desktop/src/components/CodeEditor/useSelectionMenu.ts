import type { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

export function useSelectionMenu({
  viewRef,
  host,
  markdown,
  svgImage,
  binaryImage,
  path,
  onAskFile,
}: {
  viewRef: RefObject<EditorView | null>;
  host: RefObject<HTMLDivElement | null>;
  markdown: boolean;
  svgImage: boolean;
  binaryImage: boolean;
  path: string;
  onAskFile?: (path: string, range: { start: number; end: number }) => void;
}) {
  const onAskFileRef = useRef(onAskFile);
  const [selectionMenu, setSelectionMenu] = useState<{
    from: number;
    to: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    onAskFileRef.current = onAskFile;
  }, [onAskFile]);

  const updateSelectionMenu = useCallback(() => {
    const view = viewRef.current;
    if (!view || !onAskFileRef.current || markdown || svgImage || binaryImage) {
      setSelectionMenu(null);
      return;
    }
    const sel = view.state.selection.main;
    if (sel.empty) {
      setSelectionMenu(null);
      return;
    }
    const from = Math.min(sel.from, sel.to);
    const to = Math.max(sel.from, sel.to);
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    if (!start) {
      setSelectionMenu(null);
      return;
    }
    // Place the action relative to the host container, since the button is
    // absolutely positioned inside it and coordsAtPos is viewport-relative.
    const hostRect = host.current?.getBoundingClientRect();
    const x = hostRect ? start.left - hostRect.left : start.left;
    // Single-line selections: sit below the line (above overlaps the row of
    // text the button is describing). Multi-line: float above the first line.
    const singleLine = !!end && Math.abs(end.top - start.top) < 1;
    const lineHeight = start.bottom - start.top;
    const y = hostRect
      ? singleLine
        ? start.top - hostRect.top + lineHeight + 10
        : start.top - hostRect.top - 8
      : start.top + (singleLine ? lineHeight + 10 : -8);
    setSelectionMenu({ from, to, x, y });
  }, [binaryImage, host, markdown, svgImage, viewRef]);

  const askSelection = useCallback(() => {
    const view = viewRef.current;
    const ask = onAskFileRef.current;
    if (!view || !ask || !selectionMenu) {
      return;
    }
    const docText = view.state.doc;
    setSelectionMenu(null);
    ask(path, {
      start: docText.lineAt(selectionMenu.from).number,
      end: docText.lineAt(selectionMenu.to).number,
    });
  }, [path, selectionMenu, viewRef]);

  // CodeMirror consumes mouse/key events; React handlers on the host wrapper
  // never see mouseup/keyup. Keep the latest updater in a ref the editor's own
  // dom-event extension can invoke while the view is mounted.
  const updateSelectionMenuRef = useRef(updateSelectionMenu);
  useEffect(() => {
    updateSelectionMenuRef.current = updateSelectionMenu;
  }, [updateSelectionMenu]);

  const askSelectionRef = useRef(askSelection);
  useEffect(() => {
    askSelectionRef.current = askSelection;
  }, [askSelection]);

  return {
    selectionMenu,
    setSelectionMenu,
    updateSelectionMenu,
    updateSelectionMenuRef,
    askSelection,
    askSelectionRef,
  };
}
