import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SymbolMatch } from "../protocol";
import { FindInFilesPreview } from "./FindInFilesPreview";

const match: SymbolMatch = {
  column: 7,
  line: 42,
  path: "src/daemon.ts",
  text: "const daemonPort = 61814;",
};

describe("FindInFilesPreview", () => {
  it("shows the editor skeleton while the file loads, not a sentence", () => {
    const loadFile = vi.fn<() => Promise<string>>(() => new Promise(() => {}));

    render(<FindInFilesPreview match={match} query="daemonPort" loadFile={loadFile} />);

    const skeleton = screen.getByTestId("editor-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(skeleton).toHaveAttribute("aria-label", "Loading preview");
    expect(screen.queryByText("Loading preview…")).not.toBeInTheDocument();
    expect(loadFile).toHaveBeenCalledWith("src/daemon.ts");
  });
});
