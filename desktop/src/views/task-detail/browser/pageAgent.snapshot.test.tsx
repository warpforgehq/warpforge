import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { agent, installPageAgent, refOf } from "./pageAgentHarness";

beforeAll(() => {
  installPageAgent();
});

afterEach(cleanup);

describe("page agent snapshots", () => {
  it("shows a role=status message with a ref in an interactive snapshot, and no page text", () => {
    render(
      <main>
        <h1>Signup</h1>
        <p>Read this paragraph</p>
        <div role="status">Account created for Ada. Confirmation code: SGN-V9BO62</div>
        <button type="button">Next</button>
      </main>,
    );
    const tree = agent({ action: "snapshot", interactive: true }).tree ?? "";

    expect(tree).toMatch(
      /status "Account created for Ada\. Confirmation code: SGN-V9BO62" \[e\d+\]/,
    );
    expect(tree).toContain('button "Next"');
    expect(tree).not.toContain("Read this paragraph");
    expect(tree).not.toContain('text "');
  });

  it("treats aria-live and output as live regions, and role=alert as an alert", () => {
    render(
      <main>
        <div aria-live="polite">Saved to draft</div>
        <output>Total 3 items</output>
        <div role="alert">Payment failed</div>
      </main>,
    );
    const tree = agent({ action: "snapshot", interactive: true }).tree ?? "";

    expect(tree).toMatch(/status "Saved to draft" \[e\d+\]/);
    expect(tree).toMatch(/status "Total 3 items" \[e\d+\]/);
    expect(tree).toMatch(/alert "Payment failed" \[e\d+\]/);
  });

  it("skips hidden and empty live regions", () => {
    render(
      <main>
        <div role="status" style={{ display: "none" }}>
          Hidden notice
        </div>
        <div role="status"></div>
      </main>,
    );
    const tree = agent({ action: "snapshot" }).tree ?? "";

    expect(tree).not.toContain("Hidden notice");
    expect(tree).not.toContain("status");
  });

  it("keeps a status message longer than 160 characters whole", () => {
    render(<div role="status">{"x".repeat(200) + " CODE-AT-END"}</div>);
    const tree = agent({ action: "snapshot", interactive: true }).tree ?? "";

    expect(tree).toContain("CODE-AT-END");
    expect(tree).not.toContain("…");
  });

  it("outlines a live region longer than 600 characters instead of flattening it", () => {
    render(
      <div aria-live="polite">
        <h2>Results</h2>
        <p>{"y".repeat(650)}</p>
        <button type="button">Next page</button>
      </div>,
    );
    const tree = agent({ action: "snapshot" }).tree ?? "";

    expect(tree).toMatch(/^status \[e\d+\]:$/m);
    expect(tree).toContain('heading "Results" (h2)');
    expect(tree).toContain('button "Next page"');
  });

  it("keeps a scoped paragraph past 160 characters, up to 1000", () => {
    const body = `${"alpha ".repeat(150)}ENDMARK`;
    render(
      <main>
        <h1>Doc</h1>
        <form aria-label="Note">
          <p>{body}</p>
        </form>
      </main>,
    );
    const full = agent({ action: "snapshot" }).tree ?? "";
    const scope = refOf(full, 'form "Note"');
    const scoped = agent({ action: "snapshot", scope }).tree ?? "";

    expect(full).not.toContain("ENDMARK");
    expect(scoped).toContain("ENDMARK");
  });

  it("prints a live region's text once in a full snapshot", () => {
    render(
      <main>
        <div role="status">Saved successfully</div>
      </main>,
    );
    const tree = agent({ action: "snapshot" }).tree ?? "";

    expect(tree).toMatch(/status "Saved successfully" \[e\d+\]/);
    expect(tree.split("Saved successfully")).toHaveLength(2);
  });
});
