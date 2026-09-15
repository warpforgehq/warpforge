import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ToolOutput } from "./ToolOutput";

function lineWith(text: string): HTMLElement {
  const node = screen.getByText(text);
  return node as HTMLElement;
}

describe("ToolOutput", () => {
  it("renders plain text in a single scrolling pre", () => {
    const { container } = render(<ToolOutput content={"1 test passed"} />);
    const pres = container.querySelectorAll("pre");
    expect(pres).toHaveLength(1);
    expect(pres[0].textContent).toBe("1 test passed");
    expect(pres[0].className).toContain("max-h-56");
  });

  it("keeps the max height on a mixed body", () => {
    const { container } = render(<ToolOutput content={"head\n```ts\nconst a = 1;\n```"} />);
    expect(container.firstElementChild?.className).toContain("max-h-56");
    expect(container.firstElementChild?.className).toContain("overflow-auto");
  });

  it("drops the fence lines and labels a known language", () => {
    render(<ToolOutput content={"```console\n$ ls\n```"} />);
    expect(screen.getByText("console")).toBeTruthy();
    expect(screen.getByText("$ ls")).toBeTruthy();
    expect(screen.queryByText("```console")).toBeNull();
  });

  it("renders an unknown tag as code with no label", () => {
    const { container } = render(<ToolOutput content={"plain\n```gibberish\nbody\n```"} />);
    expect(screen.getByText("body")).toBeTruthy();
    expect(screen.queryByText("gibberish")).toBeNull();
    expect(container.querySelector(".bg-muted\\/50")).toBeTruthy();
  });

  it("tints diff lines by kind", () => {
    render(<ToolOutput content={"```diff\n@@ -1,2 +1,2 @@\n-gone\n+here\n kept\n```"} />);
    expect(lineWith("+here").className).toContain("bg-ok/10");
    expect(lineWith("-gone").className).toContain("bg-destructive/10");
    expect(lineWith("@@ -1,2 +1,2 @@").className).toContain("text-muted-foreground/60");
    expect(lineWith("kept").className).toContain("text-foreground/70");
  });

  it("tints an unfenced diff too", () => {
    render(<ToolOutput content={"diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new"} />);
    expect(lineWith("+new").className).toContain("bg-ok/10");
    expect(lineWith("diff --git a/a.ts b/a.ts").className).toContain("text-muted-foreground/60");
  });

  it("renders untrusted output as text, never as markup", () => {
    const { container } = render(<ToolOutput content={"```\n<img src=x onerror=1>\n```"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("<img src=x onerror=1>")).toBeTruthy();
  });
});
