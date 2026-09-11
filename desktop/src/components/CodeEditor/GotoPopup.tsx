import type { CSSProperties } from "react";

import type { SymbolMatch } from "../../protocol";
import { cn } from "@/lib/utils";

export function GotoPopup({
  gotoResults,
  gotoPending,
  gotoActive,
  setGotoActive,
  gotoQuery,
  gotoPos,
  pickGoto,
}: {
  gotoResults: SymbolMatch[];
  gotoPending: boolean;
  gotoActive: number;
  setGotoActive: (index: number) => void;
  gotoQuery: string;
  gotoPos: { x: number; y: number } | null;
  pickGoto: (index: number) => void;
}) {
  return (
    <div
      data-goto-popup
      className="absolute z-20 w-[640px] max-w-[80vw] overflow-hidden rounded-md border bg-popover shadow-lg"
      style={{ left: gotoPos?.x ?? 8, top: gotoPos?.y ?? 8 }}
    >
      <div className="border-b px-3 py-1.5 text-xs font-semibold">Go to definition</div>
      {gotoPending ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">Searching for {gotoQuery}…</div>
      ) : gotoResults.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">
          No definition found for {gotoQuery}
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto py-1">
          {gotoResults.map((hit, index) => {
            const slash = hit.path.lastIndexOf("/");
            const dir = slash >= 0 ? hit.path.slice(0, slash + 1) : "";
            const file = slash >= 0 ? hit.path.slice(slash + 1) : hit.path;
            return (
              <button
                key={`${hit.path}:${hit.line}`}
                type="button"
                onMouseEnter={() => setGotoActive(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pickGoto(index);
                }}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-3 py-2 text-left",
                  index === gotoActive ? "bg-accent text-accent-foreground" : "text-foreground",
                )}
              >
                <span
                  className="w-full truncate text-[11px] leading-4 text-muted-foreground"
                  title={`${hit.path}:${hit.line}`}
                >
                  <span
                    style={
                      {
                        direction: "ltr",
                        unicodeBidi: "plaintext",
                      } as CSSProperties
                    }
                  >
                    {dir}
                    <span className="font-semibold text-foreground/80">{file}</span>
                    <span className="tabular-nums">:{hit.line}</span>
                  </span>
                </span>
                <span className="w-full truncate font-mono text-xs leading-4">
                  {hit.text.trim() || <span className="text-muted-foreground">(empty line)</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
