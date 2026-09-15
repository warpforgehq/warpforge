import { MergeView } from "@codemirror/merge";
import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { Check, ChevronDown, Send, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { PaneHeader } from "@/components/workspace";
import { useThemeMode } from "@/hooks/useTheme";
import { codemirrorLanguageForPath } from "@/lib/codemirrorLanguages";
import { cmChromeForMode } from "@/lib/codemirrorTheme";
import { cn } from "@/lib/utils";

import type { FileDiff, FileDoc } from "../protocol";

type SaveStatus = "clean" | "unsaved" | "saved";

/**
 * Editable side-by-side review of one file: HEAD (left, read-only) vs the
 * working tree (right, editable) via CodeMirror's MergeView. Per-chunk revert
 * arrows (↩) discard an agent change; edits stay unsaved until ⌘S or the save
 * action runs. "Discard edits" restores the file to how the agent left it.
 */
export function MergeDiff({
  doc,
  file,
  editable,
  collapsed,
  onToggleCollapsed,
  onSave,
  onSendToChat,
}: {
  doc: FileDoc;
  file?: FileDiff;
  editable: boolean;
  /** The file's diff body is folded to its header. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onSave: (content: string) => void;
  onSendToChat?: (file: FileDiff) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<MergeView | null>(null);
  const onSaveRef = useRef(onSave);
  const originalRef = useRef(doc.newText);
  const [status, setStatus] = useState<SaveStatus>("clean");
  const themeMode = useThemeMode();

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    originalRef.current = doc.newText;
  }, [doc.newText]);

  const flushSave = () => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const text = view.b.state.doc.toString();
    onSaveRef.current(text);
    setStatus("saved");
  };

  const discard = () => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.b.dispatch({
      changes: { from: 0, insert: originalRef.current, to: view.b.state.doc.length },
    });
    flushSave();
  };

  useEffect(() => {
    const parent = host.current;
    if (!parent || collapsed) {
      return;
    }
    let disposed = false;
    let view: MergeView | null = null;

    void codemirrorLanguageForPath(doc.path).then((lang) => {
      if (disposed) return;
      const common: Extension[] = [
        lineNumbers(),
        ...cmChromeForMode(themeMode),
        EditorView.lineWrapping,
        ...lang,
      ];
      view = new MergeView({
        a: {
          doc: doc.oldText,
          extensions: [...common, EditorState.readOnly.of(true)],
        },
        b: {
          doc: doc.newText,
          extensions: [
            ...common,
            EditorState.readOnly.of(!editable),
            keymap.of([{ key: "Mod-s", run: () => (flushSave(), true) }]),
            EditorView.updateListener.of((u) => {
              if (!u.docChanged) return;
              setStatus("unsaved");
            }),
          ],
        },
        collapseUnchanged: { margin: 3, minSize: 4 },
        // The default scanLimit (500) makes the Myers diff bail out to a crude
        // Match on any region over ~4k chars, which paints a whole file as
        // Changed after a one-line insert. Source files need a real diff.
        diffConfig: { scanLimit: 20000, timeout: 250 },
        gutter: true,
        highlightChanges: true,
        parent,
        revertControls: editable ? "a-to-b" : undefined,
      });
      viewRef.current = view;
    });

    return () => {
      disposed = true;
      view?.destroy();
      if (viewRef.current === view) {
        viewRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.path, editable, themeMode, collapsed]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentOld = view.a.state.doc.toString();
    if (currentOld !== doc.oldText) {
      view.a.dispatch({
        changes: { from: 0, insert: doc.oldText, to: currentOld.length },
      });
    }
  }, [doc.oldText]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (status === "clean") {
      const currentNew = view.b.state.doc.toString();
      if (currentNew !== doc.newText) {
        view.b.dispatch({
          changes: { from: 0, insert: doc.newText, to: currentNew.length },
        });
      }
    }
  }, [doc.newText, status]);

  return (
    <div className="flex flex-col">
      {(editable || onSendToChat || onToggleCollapsed) && (
        <PaneHeader
          mono
          title={doc.path}
          leading={
            onToggleCollapsed ? (
              <button
                type="button"
                aria-label={collapsed ? `Expand ${doc.path}` : `Collapse ${doc.path}`}
                title={collapsed ? "Expand this file's diff" : "Collapse this file's diff"}
                onClick={onToggleCollapsed}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
              >
                <ChevronDown
                  className={cn("size-3.5 transition-transform", collapsed && "-rotate-90")}
                />
              </button>
            ) : undefined
          }
          actions={
            <>
              {editable && (
                <span
                  className={cn(
                    "flex items-center gap-1 whitespace-nowrap text-[11px]",
                    status === "unsaved" && "text-warn",
                    status === "saved" && "text-ok",
                  )}
                >
                  {status === "unsaved" ? (
                    "● unsaved"
                  ) : status === "saved" ? (
                    <>
                      <Check className="size-3" /> saved
                    </>
                  ) : null}
                </span>
              )}
              {editable && (
                <button
                  type="button"
                  onClick={discard}
                  className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  title="Restore this file to how the agent left it"
                >
                  <Undo2 className="size-3" /> revert
                </button>
              )}
              {file && onSendToChat && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-5 shrink-0 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => onSendToChat(file)}
                  title="Send this file's diff to chat"
                >
                  <Send className="size-3" />
                  send
                </Button>
              )}
            </>
          }
        />
      )}
      {!collapsed && (
        <div
          ref={host}
          className="warpforge-merge-diff overflow-x-auto bg-card"
          style={{ fontSize: "var(--app-mono-font-size)" }}
        />
      )}
    </div>
  );
}
