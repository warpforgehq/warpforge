import { useEffect, useId, useRef, useState } from "react";

import { useThemeMode } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

/**
 * One ```mermaid fence, drawn. Lazily imported (~1 MB), and a diagram that
 * fails to parse falls back to its source — agents get the syntax wrong often.
 */
export function MermaidDiagram({ code, className }: { code: string; className?: string }) {
  const mode = useThemeMode();
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const domId = `mermaid-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(null);
    void (async () => {
      try {
        const mermaid = await loadMermaid(mode);
        await mermaid.parse(code);
        const { svg: rendered } = await mermaid.render(domId, code, host.current ?? undefined);
        if (!cancelled) setSvg(rendered);
      } catch (error) {
        if (!cancelled) {
          setSvg(null);
          // Named, not swallowed: a silent fallback to the source block is
          // indistinguishable from "this app cannot draw diagrams", which
          // cost an afternoon of guessing once already.
          setFailed(error instanceof Error ? error.message : String(error));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, domId, mode]);

  if (failed !== null) {
    return <MermaidSource code={code} reason={failed} className={className} />;
  }

  return (
    <div
      ref={host}
      className={cn(
        "my-2 overflow-x-auto rounded-md border border-border/70 bg-card/40 p-3",
        // No empty frame before the diagram lands.
        !svg && "hidden",
        className,
      )}
      // Mermaid's own output, after its DOMPurify pass.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

function MermaidSource({
  code,
  reason,
  className,
}: {
  code: string;
  reason: string;
  className?: string;
}) {
  return (
    <div className="my-2">
      <p className="text-[11px] text-muted-foreground/70" title={reason}>
        Diagram could not be rendered — showing its source.
      </p>
      <pre
        className={cn(
          "my-2 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/50 p-2.5 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]",
          className,
        )}
      >
        <code className="font-mono">{code}</code>
      </pre>
    </div>
  );
}

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  parse: (code: string) => Promise<unknown>;
  render: (id: string, code: string, container?: Element) => Promise<{ svg: string }>;
};

let mermaidModule: Promise<MermaidApi> | null = null;
let initialisedMode: "light" | "dark" | null = null;

async function loadMermaid(mode: "light" | "dark"): Promise<MermaidApi> {
  mermaidModule ??= import("mermaid").then((module) => module.default as unknown as MermaidApi);
  const mermaid = await mermaidModule;
  if (initialisedMode !== mode) {
    mermaid.initialize({
      // `securityLevel: strict` keeps click handlers and raw HTML out of the
      // diagram; agent-authored markdown is untrusted input.
      securityLevel: "strict",
      startOnLoad: false,
      theme: mode === "dark" ? "dark" : "default",
    });
    initialisedMode = mode;
  }
  return mermaid;
}

/** Test seam: forget the cached module so a fresh mock is picked up. */
export function resetMermaidCache(): void {
  mermaidModule = null;
  initialisedMode = null;
}
