import { useState, type DragEvent, type RefObject } from "react";

import { FILE_REF_MIME, insertFileRef, isFileRefDrag } from "@/lib/composerMentions";

/**
 * Drag-and-drop onto the composer: a project file reference becomes an
 * `@path` at the caret, anything else is attached as a file.
 */
export function useComposerDrop({
  textRef,
  value,
  setValue,
  setCaret,
  fileSet,
  attach,
}: {
  textRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (value: string) => void;
  setCaret: (caret: number) => void;
  fileSet: Set<string>;
  attach: (files: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [refDrag, setRefDrag] = useState(false);

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      setRefDrag(isFileRefDrag(Array.from(e.dataTransfer.types)));
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => e.preventDefault(),
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
        setDragging(false);
        setRefDrag(false);
      }
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      setRefDrag(false);
      const mimePath = e.dataTransfer.getData?.(FILE_REF_MIME) ?? "";
      const plainPath = e.dataTransfer.getData?.("text/plain") ?? "";
      const refPath =
        mimePath && fileSet.has(mimePath)
          ? mimePath
          : plainPath && fileSet.has(plainPath)
            ? plainPath
            : "";
      if (refPath) {
        const dropCaret = textRef.current?.selectionStart ?? value.length;
        const result = insertFileRef(value, dropCaret, refPath);
        setValue(result.value);
        setCaret(result.caret);
        requestAnimationFrame(() => {
          textRef.current?.focus();
          textRef.current?.setSelectionRange(result.caret, result.caret);
        });
        return;
      }
      attach([...e.dataTransfer.files]);
    },
  };

  return { dragging, refDrag, handlers };
}
