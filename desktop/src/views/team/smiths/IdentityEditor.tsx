import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

import { useThemeMode } from "@/hooks/useTheme";
import { cmChromeForMode } from "@/lib/codemirrorTheme";

interface Props {
  value: string;
  onChange: (value: string) => void;
  language: "markdown" | "yaml";
  label: string;
  placeholder?: string;
}

/** A small CodeMirror editor for a teammate's soul (markdown) or charter (YAML). */
export function IdentityEditor({ value, onChange, language, label, placeholder }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  // Set while the editor takes a new `value` from its parent, so that update
  // is not reported back as the user's edit.
  const syncing = useRef(false);
  onChangeRef.current = onChange;
  const themeMode = useThemeMode();

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: viewRef.current?.state.doc.toString() ?? value,
        extensions: [
          basicSetup,
          language === "markdown" ? markdown() : yaml(),
          ...cmChromeForMode(themeMode),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncing.current) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => view.destroy();
    // `value` seeds the editor; later values arrive through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label, language, themeMode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    syncing.current = true;
    view.dispatch({ changes: { from: 0, insert: value, to: view.state.doc.length } });
    syncing.current = false;
  }, [value]);

  return (
    <div className="relative">
      <div
        ref={host}
        className="max-h-80 min-h-32 overflow-auto rounded-md border border-border text-[13px]"
      />
      {!value && placeholder && (
        <p className="pointer-events-none absolute left-10 top-1.5 text-[13px] text-muted-foreground">
          {placeholder}
        </p>
      )}
    </div>
  );
}
