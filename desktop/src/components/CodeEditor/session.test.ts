import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EditorViewState } from "@/lib/sessionStore";

import { applyEditorPosition, installEditorSession } from "./session";

function createView(doc = "one\ntwo\nthree"): { view: EditorView; host: HTMLDivElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const view = new EditorView({ parent: host, state: EditorState.create({ doc }) });
  return { host, view };
}

function viewState(overrides: Partial<EditorViewState>): EditorViewState {
  return {
    anchor: 0,
    head: 0,
    path: "a.rs",
    scrollLeft: 0,
    scrollTop: 0,
    updatedAt: 0,
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("editor session restore", () => {
  it("clamps a saved cursor past the end of a shrunken document", () => {
    const { view } = createView("short");
    applyEditorPosition(view, viewState({ anchor: 9999, head: 9999 }));

    expect(view.state.selection.main.anchor).toBe(view.state.doc.length);
    view.destroy();
  });

  it("restores the saved selection and scroll offset", async () => {
    const { view } = createView();
    applyEditorPosition(view, viewState({ anchor: 2, head: 2, scrollTop: 12, scrollLeft: 3 }));

    expect(view.state.selection.main.anchor).toBe(2);
    // jsdom has no layout, so scrollTop stays 0; flush the frame to prove the
    // rAF path runs without throwing.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    view.destroy();
  });

  it("reports cursor movement through the session listener", async () => {
    const { view } = createView();
    const onChange = vi.fn<(position: { anchor: number }) => void>();
    const cleanup = installEditorSession(view, onChange);

    view.dispatch({ selection: { anchor: 5 } });
    view.dom.dispatchEvent(new Event("keyup"));
    await new Promise((resolve) => requestAnimationFrame(resolve));

    expect(onChange).toHaveBeenCalled();
    const calls = onChange.mock.calls;
    expect(calls[calls.length - 1]?.[0].anchor).toBe(5);

    cleanup();
    view.destroy();
  });
});
