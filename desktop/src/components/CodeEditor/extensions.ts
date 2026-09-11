import { lintGutter } from "@codemirror/lint";
import { jumpToDefinition } from "@codemirror/lsp-client";
import type { Compartment, Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { changeGutterExtension, type ChangeBlock, type DeletedBlock } from "@/lib/changeGutter";
import { cmChromeForMode } from "@/lib/codemirrorTheme";

import type { FileDoc, FileRange, SymbolMatch } from "../../protocol";
import type { SaveStatus } from "./constants";

export function buildEditorExtensions({
  doc,
  editable,
  isReadOnly,
  themeMode,
  language,
  lspCompartment,
  changeGutterCompartment,
  flushSave,
  onGotoDefinition,
  onAskFile,
  runGoto,
  runSymbolGoto,
  triggerSymbolSearch,
  askSelectionRef,
  updateSelectionMenuRef,
  handleGutterClickRef,
  clearGoto,
  setStatus,
  setText,
  viewRef,
}: {
  doc: FileDoc;
  editable: boolean;
  isReadOnly: boolean;
  themeMode: "light" | "dark";
  language: Extension[];
  lspCompartment: Compartment;
  changeGutterCompartment: Compartment;
  flushSave: () => boolean;
  onGotoDefinition?: (query: string) => Promise<SymbolMatch[]>;
  onAskFile?: (path: string, range: FileRange) => void;
  runGoto: () => boolean;
  runSymbolGoto: () => boolean;
  triggerSymbolSearch: (mouseCoords?: { x: number; y: number } | null) => boolean;
  askSelectionRef: RefObject<() => void>;
  updateSelectionMenuRef: RefObject<() => void>;
  handleGutterClickRef: RefObject<
    (info: { block: ChangeBlock | DeletedBlock; line: number }) => void
  >;
  clearGoto: () => void;
  setStatus: Dispatch<SetStateAction<SaveStatus>>;
  setText: Dispatch<SetStateAction<string>>;
  viewRef: RefObject<EditorView | null>;
}): Extension[] {
  return [
    basicSetup,
    lintGutter(),
    ...cmChromeForMode(themeMode),
    EditorView.lineWrapping,
    ...language,
    lspCompartment.of([]),
    EditorState.readOnly.of(!editable || isReadOnly),
    // WebStorm-style change gutter — thin bar, no background, click for revert/commit
    ...(!isReadOnly && doc.oldText !== undefined
      ? [
          changeGutterCompartment.of(
            changeGutterExtension(doc.oldText, (info) => handleGutterClickRef.current(info)),
          ),
        ]
      : []),
    keymap.of([
      { key: "Mod-s", run: flushSave },
      ...(onGotoDefinition
        ? [
            { key: "Mod-b", run: runGoto, preventDefault: true },
            { key: "Mod-Shift-b", run: runSymbolGoto, preventDefault: true },
          ]
        : []),
      ...(onAskFile
        ? [
            {
              key: "Mod-l",
              run: () => {
                askSelectionRef.current();
                return true;
              },
              preventDefault: true,
            },
          ]
        : []),
    ]),
    ...(onGotoDefinition
      ? [
          EditorView.domEventHandlers({
            mousedown(event, cv) {
              if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
                return false;
              }
              event.preventDefault();
              const pos = cv.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos === null) {
                return false;
              }
              cv.dispatch({ selection: { anchor: pos } });
              const clickCoords = { x: event.clientX, y: event.clientY };
              const lspHandled = jumpToDefinition(cv);
              if (!lspHandled) {
                triggerSymbolSearch(clickCoords);
              } else {
                const anchorBefore = pos;
                window.setTimeout(() => {
                  const v = viewRef.current;
                  if (!v) return;
                  if (v.state.selection.main.head === anchorBefore) {
                    triggerSymbolSearch(clickCoords);
                  }
                }, 450);
                clearGoto();
              }
              return true;
            },
          }),
        ]
      : []),
    ...(onAskFile
      ? [
          EditorView.domEventHandlers({
            mouseup: () => {
              updateSelectionMenuRef.current();
              return false;
            },
            keyup: () => {
              updateSelectionMenuRef.current();
              return false;
            },
          }),
        ]
      : []),
    EditorView.updateListener.of((u) => {
      if (!u.docChanged) {
        return;
      }
      setStatus("unsaved");
      const next = u.state.doc.toString();
      setText(next);
    }),
  ];
}
