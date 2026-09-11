import { Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import {
  applyRevert,
  changeGutterExtension,
  computeGutterChanges,
  type ChangeBlock,
  type DeletedBlock,
} from "@/lib/changeGutter";

import { daemon } from "../../daemon";
import type { FileDoc } from "../../protocol";
import type { SaveStatus } from "./constants";

export function useChangeGutter({
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
}: {
  viewRef: RefObject<EditorView | null>;
  host: RefObject<HTMLDivElement | null>;
  changeGutterCompartment: RefObject<Compartment>;
  doc: FileDoc;
  project?: string;
  taskId: string;
  binaryImage: boolean;
  isReadOnly: boolean;
  lastSaved: RefObject<string | null>;
  onSaveRef: RefObject<(content: string) => void>;
  setStatus: Dispatch<SetStateAction<SaveStatus>>;
  setText: Dispatch<SetStateAction<string>>;
}) {
  // Change-gutter popup state (WebStorm-style)
  const [activeChange, setActiveChange] = useState<{
    block: ChangeBlock | DeletedBlock;
    line: number;
    x: number;
    y: number;
  } | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [committing, setCommitting] = useState(false);
  const activeChangeRef = useRef(activeChange);
  useEffect(() => {
    activeChangeRef.current = activeChange;
  }, [activeChange]);

  const handleGutterClick = useCallback(
    (info: { block: ChangeBlock | DeletedBlock; line: number }) => {
      const view = viewRef.current;
      if (!view) return;
      const lineNum = info.line;
      const line = view.state.doc.line(Math.min(Math.max(lineNum, 1), view.state.doc.lines));
      const coords = view.coordsAtPos(line.from);
      const hostRect = host.current?.getBoundingClientRect();
      if (!coords || !hostRect) {
        setActiveChange({ block: info.block, line: info.line, x: 24, y: 0 });
        return;
      }
      // Position popup just to the right of gutter, aligned to line top
      const x = 24;
      const y = coords.top - hostRect.top + view.scrollDOM.scrollTop;
      setActiveChange({ block: info.block, line: info.line, x, y });
      setCommitMsg("");
    },
    [host, viewRef],
  );

  const handleGutterClickRef = useRef(handleGutterClick);
  useEffect(() => {
    handleGutterClickRef.current = handleGutterClick;
  }, [handleGutterClick]);

  const revertActive = useCallback(() => {
    const view = viewRef.current;
    const cur = activeChangeRef.current;
    if (!view || !cur) return;
    applyRevert(view, cur.block);
    // mark unsaved then save
    setStatus("unsaved");
    const next = view.state.doc.toString();
    setText(next);
    // auto-save the revert
    setTimeout(() => {
      const current = view.state.doc.toString();
      lastSaved.current = current;
      setText(current);
      onSaveRef.current(current);
      setStatus("saved");
    }, 0);
    setActiveChange(null);
  }, [lastSaved, onSaveRef, setStatus, setText, viewRef]);

  const commitActive = useCallback(async () => {
    const msg = commitMsg.trim();
    if (!msg) return;
    setCommitting(true);
    try {
      // Save first if unsaved
      const view = viewRef.current;
      if (view) {
        const current = view.state.doc.toString();
        if (current !== lastSaved.current) {
          lastSaved.current = current;
          setText(current);
          onSaveRef.current(current);
          setStatus("saved");
          // give daemon a moment to write file before commit? commit will read working tree, so wait a tick
          await new Promise((r) => setTimeout(r, 120));
        }
      }
      await daemon.request("git.commit", {
        task_id: project ? "" : taskId,
        project: project ?? undefined,
        message: msg,
        files: [doc.path],
      } as unknown as Record<string, unknown>);
      setActiveChange(null);
      setCommitMsg("");
      // After commit the file is now clean — head catches up to working tree.
      // Reconfigure gutter so its baseline becomes the just-committed text.
      const view2 = viewRef.current;
      if (view2) {
        const newOld = view2.state.doc.toString();
        view2.dispatch({
          effects: changeGutterCompartment.current.reconfigure(
            changeGutterExtension(newOld, (info) => handleGutterClickRef.current(info)),
          ),
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("commit failed", e);
    } finally {
      setCommitting(false);
    }
  }, [
    changeGutterCompartment,
    commitMsg,
    doc.path,
    lastSaved,
    onSaveRef,
    project,
    setStatus,
    setText,
    taskId,
    viewRef,
  ]);

  const navigateChange = useCallback(
    (dir: 1 | -1) => {
      const view = viewRef.current;
      if (!view) return;
      const curText = view.state.doc.toString();
      const changes = computeGutterChanges(doc.oldText, curText);
      const all: Array<{ line: number; block: ChangeBlock | DeletedBlock }> = [];
      for (const b of changes.blocks) all.push({ line: b.from, block: b });
      for (const d of changes.deleted) all.push({ line: d.line, block: d });
      all.sort((a, b) => a.line - b.line);
      if (all.length === 0) return;
      const curLine = activeChangeRef.current?.line ?? (dir === 1 ? 0 : Number.MAX_SAFE_INTEGER);
      let idx = all.findIndex((a) => a.block === activeChangeRef.current?.block);
      if (idx === -1) {
        // find nearest
        if (dir === 1) idx = all.findIndex((a) => a.line > curLine);
        else idx = [...all].reverse().findIndex((a) => a.line < curLine);
        if (idx === -1) idx = dir === 1 ? 0 : all.length - 1;
        else if (dir === -1) idx = all.length - 1 - idx;
      } else {
        idx = (idx + dir + all.length) % all.length;
      }
      const target = all[idx];
      if (!target) return;
      const line = view.state.doc.line(Math.min(target.line, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
      view.focus();
      const coords = view.coordsAtPos(line.from);
      const hostRect = host.current?.getBoundingClientRect();
      const x = 24;
      const y = coords && hostRect ? coords.top - hostRect.top + view.scrollDOM.scrollTop : 0;
      setActiveChange({ block: target.block, line: target.line, x, y });
    },
    [doc.oldText, host, viewRef],
  );

  // Close change-gutter popup when clicking outside or pressing Escape
  useEffect(() => {
    if (!activeChange) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-change-popup]") || target?.closest(".cm-changeGutter")) return;
      setActiveChange(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveChange(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [activeChange]);

  // Dismiss popup on scroll (otherwise it floats at stale coords)
  useEffect(() => {
    if (!activeChange || !viewRef.current) return;
    const scroller = viewRef.current.scrollDOM;
    const onScroll = () => setActiveChange(null);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [activeChange, viewRef]);

  useEffect(() => {
    // any external doc change dismisses popup (avoid stale coordinates)
    setActiveChange(null);
  }, [doc.path, doc.oldText]);

  // Keep gutter baseline in sync when HEAD changes (e.g., after commit the parent refetches).
  useEffect(() => {
    const view = viewRef.current;
    if (!view || binaryImage || isReadOnly || doc.oldText === undefined) return;
    view.dispatch({
      effects: changeGutterCompartment.current.reconfigure(
        changeGutterExtension(doc.oldText, (info) => handleGutterClickRef.current(info)),
      ),
    });
  }, [binaryImage, changeGutterCompartment, doc.oldText, isReadOnly, viewRef]);

  return {
    activeChange,
    setActiveChange,
    commitMsg,
    setCommitMsg,
    committing,
    handleGutterClick,
    handleGutterClickRef,
    revertActive,
    commitActive,
    navigateChange,
  };
}
