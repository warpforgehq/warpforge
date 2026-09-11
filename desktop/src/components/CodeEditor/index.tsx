import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";

import { useThemeMode } from "@/hooks/useTheme";
import { codemirrorLanguageForPath } from "@/lib/codemirrorLanguages";
import { cn } from "@/lib/utils";

import type { FileDoc, FileRange, SymbolMatch } from "../../protocol";
import { BinaryPreview, PreviewPane } from "./PreviewPane";
import { ChangePopup } from "./ChangePopup";
import {
  isBinaryImagePath,
  isHtmlPath,
  isMarkdownPath,
  isSvgPath,
  SEND_TO_CHAT_HINT,
} from "./constants";
import { EditorToolbar } from "./EditorToolbar";
import { buildEditorExtensions } from "./extensions";
import { GotoPopup } from "./GotoPopup";
import { useChangeGutter } from "./useChangeGutter";
import { useEditorSave } from "./useEditorSave";
import { useGoto } from "./useGoto";
import { useLspClient } from "./useLspClient";
import { useSelectionMenu } from "./useSelectionMenu";

export function CodeEditor({
  doc,
  editable,
  taskId,
  project,
  onSave,
  onGotoDefinition,
  onOpenSymbol,
  gotoLocation,
  onGotoLocationHandled,
  onAskFile,
}: {
  doc: FileDoc;
  editable: boolean;
  taskId: string;
  project?: string;
  onSave: (content: string) => void;
  /** Resolve a symbol under the cursor to project lines (go-to-definition).
   *  When provided, ⌘/Ctrl-click and ⌘B run it. */
  onGotoDefinition?: (query: string) => Promise<SymbolMatch[]>;
  /** Open a found symbol's file at its line/column. */
  onOpenSymbol?: (path: string, line: number, column: number) => void;
  /** Move the editor to a pending 1-based source location after it loads. */
  gotoLocation?: { line: number; column: number };
  onGotoLocationHandled?: () => void;
  /** When provided, a floating "Send to chat" action appears over text
   * selections that sends the highlighted line range to the task chat as a
   * file reference. */
  onAskFile?: (path: string, range: FileRange) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const lspCompartment = useRef(new Compartment());
  const changeGutterCompartment = useRef(new Compartment());
  const gotoLocationKey = useRef<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const markdown = isMarkdownPath(doc.path);
  const htmlDoc = isHtmlPath(doc.path);
  const svgImage = isSvgPath(doc.path);
  const binaryImage = isBinaryImagePath(doc.path);
  const themeMode = useThemeMode();
  const showPreview = (markdown || htmlDoc || svgImage) && preview;
  const isReadOnly = binaryImage || svgImage;

  const save = useEditorSave({ viewRef, doc, onSave });
  const { status, text, setText, setStatus, lastSaved, onSaveRef, flushSave } = save;
  const previewText = text;

  const gutter = useChangeGutter({
    viewRef,
    host,
    changeGutterCompartment,
    doc,
    project,
    taskId,
    binaryImage,
    isReadOnly,
    lastSaved,
    onSaveRef,
    setStatus,
    setText,
  });

  const goto = useGoto({ viewRef, host, path: doc.path, onGotoDefinition, onOpenSymbol });

  const selection = useSelectionMenu({
    viewRef,
    host,
    markdown,
    svgImage,
    binaryImage,
    path: doc.path,
    onAskFile,
  });

  const lsp = useLspClient({
    viewRef,
    lspCompartment,
    docPath: doc.path,
    editable,
    editorReady,
    taskId,
    project,
  });

  useEffect(() => {
    const parent = host.current;
    if (!parent || binaryImage) {
      return;
    }
    let disposed = false;
    let view: EditorView | null = null;

    void codemirrorLanguageForPath(doc.path).then((language) => {
      if (disposed) return;
      setStatus("clean");
      setText(doc.newText);
      setPreview(false);
      lastSaved.current = null;
      gutter.setActiveChange(null);
      view = new EditorView({
        parent,
        state: EditorState.create({
          doc: doc.newText,
          extensions: buildEditorExtensions({
            doc,
            editable,
            isReadOnly,
            themeMode,
            language,
            lspCompartment: lspCompartment.current,
            changeGutterCompartment: changeGutterCompartment.current,
            flushSave,
            onGotoDefinition,
            onAskFile,
            runGoto: goto.runGoto,
            runSymbolGoto: goto.runSymbolGoto,
            triggerSymbolSearch: goto.triggerSymbolSearch,
            askSelectionRef: selection.askSelectionRef,
            updateSelectionMenuRef: selection.updateSelectionMenuRef,
            handleGutterClickRef: gutter.handleGutterClickRef,
            clearGoto: goto.dismissGoto,
            setStatus,
            setText,
            viewRef,
          }),
        }),
      });
      viewRef.current = view;
      setEditorReady(true);
    });

    return () => {
      disposed = true;
      setEditorReady(false);
      view?.destroy();
      if (viewRef.current === view) {
        viewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path, editable, binaryImage, isReadOnly, themeMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !editorReady || !gotoLocation) {
      if (!gotoLocation) {
        gotoLocationKey.current = null;
      }
      return;
    }
    const key = `${gotoLocation.line}:${gotoLocation.column}`;
    if (gotoLocationKey.current === key) {
      return;
    }
    const lineNumber = Math.min(Math.max(gotoLocation.line, 1), view.state.doc.lines);
    const line = view.state.doc.line(lineNumber);
    const column = Math.min(Math.max(gotoLocation.column - 1, 0), line.length);
    view.dispatch({
      selection: { anchor: line.from + column },
      // Centered, not merely "in view": a plain scrollIntoView stops as soon as
      // the line touches an edge, leaving the jump target glued to the bottom
      // with no context under it.
      effects: EditorView.scrollIntoView(line.from + column, { y: "center" }),
      userEvent: "select.goto",
    });
    // Without focus the caret sits at the target invisibly and the first
    // keystroke goes nowhere — a jump from search should land ready to type.
    view.focus();
    gotoLocationKey.current = key;
    onGotoLocationHandled?.();
  }, [editorReady, gotoLocation, onGotoLocationHandled]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorToolbar
        path={doc.path}
        status={status}
        markdown={markdown}
        htmlDoc={htmlDoc}
        svgImage={svgImage}
        preview={preview}
        onTogglePreview={() => setPreview((p) => !p)}
        isReadOnly={isReadOnly}
        editable={editable}
        onSave={flushSave}
        lspMissing={lsp.lspMissing}
        lspInstallBusy={lsp.lspInstallBusy}
        onInstallLsp={() => void lsp.installLsp()}
      />
      <div className="relative min-h-0 flex-1">
        {binaryImage ? (
          <BinaryPreview doc={doc} />
        ) : (
          <>
            <div
              ref={host}
              className={cn(
                "warpforge-code-editor h-full overflow-auto bg-card",
                showPreview && "hidden",
              )}
              style={{ fontSize: "var(--app-mono-font-size)" }}
              onMouseUp={selection.updateSelectionMenu}
              onKeyUp={selection.updateSelectionMenu}
            />
            {(goto.gotoResults.length > 0 ||
              goto.gotoPending ||
              (goto.gotoQuery && !goto.gotoPending)) &&
              !showPreview && (
                <GotoPopup
                  gotoResults={goto.gotoResults}
                  gotoPending={goto.gotoPending}
                  gotoActive={goto.gotoActive}
                  setGotoActive={goto.setGotoActive}
                  gotoQuery={goto.gotoQuery}
                  gotoPos={goto.gotoPos}
                  pickGoto={goto.pickGoto}
                />
              )}
            {selection.selectionMenu && !showPreview && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={selection.askSelection}
                className="absolute z-20 flex items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-xs font-medium text-foreground shadow-lg hover:bg-accent hover:text-accent-foreground"
                style={{ left: selection.selectionMenu.x, top: selection.selectionMenu.y }}
              >
                Send to chat
                <kbd className="rounded-sm border border-border bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground">
                  {SEND_TO_CHAT_HINT}
                </kbd>
              </button>
            )}
            {gutter.activeChange && !showPreview && !binaryImage && (
              <ChangePopup
                activeChange={gutter.activeChange}
                commitMsg={gutter.commitMsg}
                setCommitMsg={gutter.setCommitMsg}
                committing={gutter.committing}
                commitActive={gutter.commitActive}
                revertActive={gutter.revertActive}
                navigateChange={gutter.navigateChange}
                viewRef={viewRef}
                onClose={() => gutter.setActiveChange(null)}
              />
            )}
            {showPreview && (
              <PreviewPane
                doc={doc}
                htmlDoc={htmlDoc}
                svgImage={svgImage}
                previewText={previewText}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
