import { jumpToDefinition } from "@codemirror/lsp-client";
import type { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { filterByFiletype } from "@/lib/filterSymbolMatches";

import type { SymbolMatch } from "../../protocol";

export function useGoto({
  viewRef,
  host,
  path,
  onGotoDefinition,
  onOpenSymbol,
}: {
  viewRef: RefObject<EditorView | null>;
  host: RefObject<HTMLDivElement | null>;
  path: string;
  onGotoDefinition?: (query: string) => Promise<SymbolMatch[]>;
  onOpenSymbol?: (path: string, line: number, column: number) => void;
}) {
  const onGotoRef = useRef(onGotoDefinition);
  const onOpenSymbolRef = useRef(onOpenSymbol);
  const [gotoResults, setGotoResults] = useState<SymbolMatch[]>([]);
  const [gotoActive, setGotoActive] = useState(0);
  const [gotoPending, setGotoPending] = useState(false);
  const [gotoQuery, setGotoQuery] = useState("");
  const [gotoPos, setGotoPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    onGotoRef.current = onGotoDefinition;
    onOpenSymbolRef.current = onOpenSymbol;
  }, [onGotoDefinition, onOpenSymbol]);

  const triggerSymbolSearch = useCallback(
    (mouseCoords?: { x: number; y: number } | null): boolean => {
      const view = viewRef.current;
      const save = onGotoRef.current;
      if (!view || !save) return false;
      const head = view.state.selection.main.head;
      const word = view.state.wordAt(head) ?? (head > 0 ? view.state.wordAt(head - 1) : null);
      if (!word) return false;
      const query = view.state.sliceDoc(word.from, word.to).trim();
      if (!query) return false;
      const hostRect = host.current?.getBoundingClientRect();
      // For mouse triggers use event client coords; for keyboard use coordsAtPos
      let rawX: number | null = null;
      let rawY: number | null = null;
      let coordsForFlip: { top: number; bottom: number } | null = null;
      if (mouseCoords && hostRect) {
        rawX = mouseCoords.x - hostRect.left;
        rawY = mouseCoords.y - hostRect.top + 4;
      } else {
        const coords = view.coordsAtPos(head);
        if (coords && hostRect) {
          rawX = coords.left - hostRect.left;
          rawY = coords.bottom - hostRect.top + 4;
          coordsForFlip = coords;
        }
      }
      if (rawX !== null && rawY !== null && hostRect) {
        const POPUP_W = 384;
        const POPUP_H = 300;
        const maxX = hostRect.width - POPUP_W - 8;
        const hostH = host.current?.clientHeight ?? Infinity;
        let x = Math.min(rawX, maxX > 8 ? maxX : rawX);
        let y = rawY;
        if (x < 8) x = 8;
        if (y + POPUP_H > hostH - 8) {
          const flipTop = coordsForFlip
            ? coordsForFlip.top - hostRect.top - POPUP_H - 4
            : y - POPUP_H - 20;
          if (flipTop >= 0) y = flipTop;
        }
        setGotoPos({ x, y });
      } else {
        setGotoPos({ x: 8, y: 8 });
      }
      setGotoResults([]);
      setGotoQuery(query);
      setGotoPending(true);
      void save(query)
        .then((results) => {
          setGotoPending(false);
          const isWordChar = (c: string) => /[A-Za-z0-9_]/.test(c);
          const wordHit = (line: string, q: string) => {
            let idx = line.indexOf(q);
            while (idx !== -1) {
              const before = idx === 0 || !isWordChar(line[idx - 1]);
              const after = idx + q.length >= line.length || !isWordChar(line[idx + q.length]);
              if (before && after) return true;
              idx = line.indexOf(q, idx + 1);
            }
            return false;
          };
          const wordFiltered = results.filter((m) => wordHit(m.text, query));
          const filtered = filterByFiletype(
            wordFiltered.length ? wordFiltered : results.filter((m) => m.text.includes(query)),
            path,
          );
          if (!filtered.length) return;
          const qLower = query.toLowerCase();
          const score = (m: SymbolMatch) => {
            let s = 0;
            const pLower = m.path.toLowerCase();
            const fileName = pLower.split("/").pop() ?? pLower;
            if (fileName.includes(qLower)) {
              s += 100;
              const stem = fileName.split(".")[0];
              if (stem === qLower) s += 50;
            } else if (pLower.includes(qLower)) s += 20;
            const trimmed = m.text.trimStart();
            if (
              trimmed.startsWith("//") ||
              trimmed.startsWith("*") ||
              trimmed.startsWith("/*") ||
              trimmed.startsWith("#")
            )
              s -= 80;
            const lower = m.text.toLowerCase();
            if (lower.includes("export") && lower.includes(qLower)) s += 60;
            else if (
              /(function|class |interface |const |let |type |struct |enum )/.test(lower) &&
              lower.includes(qLower)
            )
              s += 40;
            if (lower.includes(`<${qLower}`)) s += 10;
            return s;
          };
          filtered.sort((a, b) => score(b) - score(a));
          setGotoResults(filtered.slice(0, 12));
          setGotoActive(0);
        })
        .catch(() => setGotoPending(false));
      return true;
    },
    [host, path, viewRef],
  );

  const runGoto = useCallback((): boolean => {
    const view = viewRef.current;
    if (!view) return false;
    // Try LSP first (handles same-file definitions).
    const lspHandled = jumpToDefinition(view);
    if (!lspHandled) {
      // No LSP definition — fall back to cross-file symbol search.
      return triggerSymbolSearch();
    }
    // LSP claimed the request (async). It may still resolve to no cross-file
    // result. Schedule symbol search as fallback if navigation didn't happen.
    const anchorBefore = view.state.selection.main.head;
    window.setTimeout(() => {
      const v = viewRef.current;
      if (!v) return;
      // If selection didn't move and no goto popup already showing, offer cross-file results.
      const anchorNow = v.state.selection.main.head;
      if (anchorNow === anchorBefore) {
        triggerSymbolSearch();
      }
    }, 450);
    // Clear any stale popup state; LSP navigation will move cursor.
    setGotoResults([]);
    setGotoPending(false);
    setGotoQuery("");
    setGotoPos(null);
    return true;
  }, [triggerSymbolSearch, viewRef]);

  // Always-symbol path — Mod+Shift+B bypasses LSP entirely for cross-file nav.
  const runSymbolGoto = useCallback((): boolean => triggerSymbolSearch(), [triggerSymbolSearch]);

  const pickGoto = useCallback(
    (index: number) => {
      const hit = gotoResults[index];
      if (!hit) {
        return;
      }
      const open = onOpenSymbolRef.current;
      setGotoResults([]);
      setGotoQuery("");
      setGotoPos(null);
      open?.(hit.path, hit.line, hit.column);
    },
    [gotoResults],
  );

  // Dismiss goto popup on outside click / Escape, mirroring activeChange popup
  const dismissGoto = useCallback(() => {
    setGotoResults([]);
    setGotoQuery("");
    setGotoPos(null);
    setGotoPending(false);
  }, []);
  useEffect(() => {
    const visible = gotoResults.length > 0 || gotoPending || !!gotoQuery;
    if (!visible) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-goto-popup]")) return;
      dismissGoto();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismissGoto();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [gotoResults.length, gotoPending, gotoQuery, dismissGoto]);

  return {
    gotoResults,
    gotoActive,
    setGotoActive,
    gotoPending,
    gotoQuery,
    gotoPos,
    triggerSymbolSearch,
    runGoto,
    runSymbolGoto,
    pickGoto,
    dismissGoto,
  };
}
