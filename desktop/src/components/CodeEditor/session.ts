import type { EditorView } from "@codemirror/view";

import type { EditorViewState } from "@/lib/sessionStore";

export interface EditorPosition {
  anchor: number;
  head: number;
  scrollLeft: number;
  scrollTop: number;
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), max);
}

/**
 * Apply a saved cursor/scroll position. Offsets are clamped to the document, so
 * a document that changed under the session never throws.
 */
export function applyEditorPosition(view: EditorView, restore: EditorViewState): void {
  const max = view.state.doc.length;
  view.dispatch({
    selection: { anchor: clamp(restore.anchor, max), head: clamp(restore.head, max) },
  });
  // The scroll node has no height until layout runs; set it a frame later.
  requestAnimationFrame(() => {
    view.scrollDOM.scrollTop = restore.scrollTop;
    view.scrollDOM.scrollLeft = restore.scrollLeft;
  });
}

/**
 * Report cursor and scroll movement from a view. Cursor changes that do not
 * scroll (arrow keys inside the viewport) still fire a `keyup`/`mouseup`, so
 * the reported position stays current without an update listener.
 */
export function installEditorSession(
  view: EditorView,
  onChange: (position: EditorPosition) => void,
): () => void {
  let pending = false;
  const report = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      onChange({
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
        scrollLeft: view.scrollDOM.scrollLeft,
        scrollTop: view.scrollDOM.scrollTop,
      });
    });
  };

  view.scrollDOM.addEventListener("scroll", report, { passive: true });
  view.dom.addEventListener("keyup", report);
  view.dom.addEventListener("mouseup", report);

  return () => {
    view.scrollDOM.removeEventListener("scroll", report);
    view.dom.removeEventListener("keyup", report);
    view.dom.removeEventListener("mouseup", report);
  };
}
