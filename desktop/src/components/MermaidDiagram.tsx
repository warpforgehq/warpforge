import { Maximize2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
  const [enlarged, setEnlarged] = useState(false);
  const domId = `mermaid-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;

  useEffect(() => {
    let cancelled = false;
    setFailed(null);
    void (async () => {
      try {
        const mermaid = await loadMermaid(mode);
        await mermaid.parse(code);
        // No container argument: mermaid measures text inside the element it is
        // given, and the host below is `display:none` until the svg lands, which
        // measures as zero and collapses the diagram to a few pixels.
        const { svg: rendered } = await mermaid.render(domId, code);
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
      className={cn(
        "group/diagram relative my-2 overflow-x-auto rounded-md border border-border bg-card/40 p-3",
        // No empty frame before the diagram lands.
        !svg && "hidden",
        className,
      )}
    >
      <div
        className={cn(svg && "cursor-zoom-in")}
        onClick={() => svg && setEnlarged(true)}
        // Mermaid's own output, after its DOMPurify pass.
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      {svg && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setEnlarged(true);
          }}
          className="absolute right-2 top-2 rounded-md border border-border bg-background/95 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:bg-secondary hover:text-foreground group-hover/diagram:opacity-100 group-focus-within/diagram:opacity-100"
          aria-label="Enlarge diagram"
          title="Enlarge diagram"
        >
          <Maximize2 className="size-3.5" />
        </button>
      )}
      <Dialog open={enlarged} onOpenChange={setEnlarged}>
        <DialogContent className="max-h-[90vh] w-[min(95vw,1400px)] max-w-[95vw] overflow-auto p-4">
          <DialogTitle className="sr-only">Diagram</DialogTitle>
          {svg && (
            <div
              className="w-full [&_svg]:h-auto [&_svg]:w-full [&_svg]:max-w-none"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
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
