import type { DragEvent } from "react";

import { FILE_REF_MIME } from "../../../lib/composerMentions";

/** Starts dragging `path` as a file reference the composer accepts. */
export function startFileDrag(event: DragEvent, path: string) {
  event.dataTransfer.setData(FILE_REF_MIME, path);
  event.dataTransfer.setData("text/plain", path);
  event.dataTransfer.effectAllowed = "copy";
  const tile = document.createElement("div");
  tile.textContent = path.split("/").pop() ?? path;
  Object.assign(tile.style, {
    position: "fixed",
    left: "0",
    top: "0",
    zIndex: "9999",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "4px 10px",
    borderRadius: "6px",
    background: "var(--accent)",
    color: "var(--accent-foreground)",
    border: "1px solid var(--border)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
    fontSize: "12px",
    fontWeight: "500",
    fontFamily: "var(--font-mono, monospace)",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    userSelect: "none",
  });
  document.body.appendChild(tile);
  event.dataTransfer.setDragImage(tile, 12, 12);
  event.currentTarget.addEventListener("dragend", () => tile.remove(), { once: true });
}
