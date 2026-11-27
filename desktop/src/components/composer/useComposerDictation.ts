import { useCallback, type RefObject } from "react";

import { insertTranscript } from "@/lib/dictation";

/**
 * Returns the composer's `insertText`: puts dictated text at the caret (or
 * over the selection) and leaves the caret after it.
 */
export function useComposerDictation({
  textRef,
  value,
  setValue,
  setCaret,
  onDraftChange,
}: {
  textRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  setValue: (value: string) => void;
  setCaret: (caret: number) => void;
  onDraftChange?: (text: string) => void;
}): (text: string) => void {
  return useCallback(
    (text: string) => {
      const el = textRef.current;
      const current = el?.value ?? value;
      const result = insertTranscript(
        current,
        el?.selectionStart ?? current.length,
        el?.selectionEnd ?? current.length,
        text,
      );
      setValue(result.value);
      setCaret(result.caret);
      onDraftChange?.(result.value);
      requestAnimationFrame(() => {
        textRef.current?.focus();
        textRef.current?.setSelectionRange(result.caret, result.caret);
      });
    },
    [onDraftChange, setCaret, setValue, textRef, value],
  );
}
