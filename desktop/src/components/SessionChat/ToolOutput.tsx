import { memo, useMemo } from "react";

import { cn } from "@/lib/utils";

import {
  diffLineKind,
  parseToolOutput,
  type DiffLineKind,
  type ToolOutputBlock,
} from "./toolOutputBlocks";

/** The scroll box every tool body lives in, plain or structured. */
const SHELL = "my-1 max-h-56 overflow-auto px-2";
const PROSE =
  "whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]";
const SURFACE = "my-1.5 overflow-hidden rounded-md border bg-muted/50 first:mt-0 last:mb-0";
const BODY =
  "overflow-x-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[12px] leading-5 [overflow-wrap:anywhere]";

const DIFF_LINE: Record<DiffLineKind, string> = {
  add: "bg-ok/10 text-foreground/90",
  context: "text-foreground/70",
  del: "bg-destructive/10 text-foreground/80",
  meta: "text-muted-foreground/60",
};

/** Keys are offsets into the content: data-dependent, and stable while it is. */
function keyed<T extends { text: string }>(items: T[]): { key: string; item: T }[] {
  let offset = 0;
  return items.map((item) => {
    const key = `${offset}`;
    offset += item.text.length + 1;
    return { item, key };
  });
}

function LanguageLabel({ label }: { label: string }) {
  return (
    <div className="select-none border-b border-rule px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
      {label}
    </div>
  );
}

const DiffBody = memo(function DiffBody({ text }: { text: string }) {
  const lines = useMemo(() => keyed(text.split("\n").map((line) => ({ text: line }))), [text]);
  return (
    <pre className="overflow-x-auto p-2.5 font-mono text-[12px] leading-5">
      {lines.map(({ key, item }) => (
        <div
          key={key}
          className={cn(
            "whitespace-pre-wrap break-words [overflow-wrap:anywhere]",
            DIFF_LINE[diffLineKind(item.text)],
          )}
        >
          {item.text || " "}
        </div>
      ))}
    </pre>
  );
});

const ALIGN: Record<"center" | "left" | "right", string> = {
  center: "text-center",
  left: "text-left",
  right: "text-right",
};

/** A markdown table from tool output — the shape `list_agents`-style replies
 *  arrive in. Cells stay text; wide tables scroll rather than wrap. */
const TableBlock = memo(function TableBlock({
  block,
}: {
  block: Extract<ToolOutputBlock, { kind: "table" }>;
}) {
  const cellAlign = (column: number) =>
    block.align[column] === null ? "text-left" : ALIGN[block.align[column]];
  return (
    <div className="my-1.5 overflow-x-auto rounded-md border first:mt-0 last:mb-0">
      <table className="border-collapse font-mono text-[12px] leading-5">
        <thead>
          <tr className="border-b border-rule bg-muted/40 text-muted-foreground">
            {block.header.map((cell, column) => (
              <th
                key={column}
                scope="col"
                className={cn("whitespace-nowrap px-2.5 py-1 font-medium", cellAlign(column))}
              >
                {cell || " "}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, index) => (
            <tr key={index} className="border-b border-rule last:border-b-0">
              {row.map((cell, column) => (
                <td
                  key={column}
                  className={cn(
                    "whitespace-nowrap px-2.5 py-1 text-foreground/80",
                    cellAlign(column),
                  )}
                >
                  {cell || " "}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

function Block({ block }: { block: ToolOutputBlock }) {
  if (block.kind === "text") return <pre className={PROSE}>{block.text}</pre>;
  if (block.kind === "table") return <TableBlock block={block} />;
  if (block.kind === "diff") {
    return (
      <div className={SURFACE}>
        <LanguageLabel label="diff" />
        <DiffBody text={block.text} />
      </div>
    );
  }
  return (
    <div className={SURFACE}>
      {block.label ? <LanguageLabel label={block.label} /> : null}
      <pre className={cn(BODY, "text-foreground/80")}>{block.text || " "}</pre>
    </div>
  );
}

/**
 * A tool step's body: fenced blocks on the house code surface, diffs with
 * per-line tinting, everything else as the plain text it already was.
 *
 * @param content raw, untrusted agent output — rendered only as text nodes
 */
export const ToolOutput = memo(function ToolOutput({ content }: { content: string }) {
  const blocks = useMemo(() => keyed(parseToolOutput(content)), [content]);

  if (blocks.length === 0 || (blocks.length === 1 && blocks[0].item.kind === "text")) {
    return <pre className={cn(SHELL, PROSE)}>{content}</pre>;
  }

  return (
    <div className={SHELL}>
      {blocks.map(({ key, item }) => (
        <Block key={key} block={item} />
      ))}
    </div>
  );
});
