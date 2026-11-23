import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { agent, installPageAgent } from "./pageAgentHarness";

beforeAll(() => {
  installPageAgent();
});

afterEach(cleanup);

function textLines(tree: string): string[] {
  return tree.split("\n").filter((line) => line.includes('text "'));
}

describe("snapshot keeps lists and tables as separate lines", () => {
  it("reads every list item as its own text line", () => {
    render(
      <ul>
        {Array.from({ length: 60 }, (_, i) => (
          <li key={i}>
            {`Part #${i + 1}`}
            {i + 1 === 57 ? " — stock code INF-0057-MARTEN" : ""}
          </li>
        ))}
      </ul>,
    );
    const tree = agent({ action: "snapshot" }).tree ?? "";

    expect(textLines(tree)).toHaveLength(60);
    expect(tree).toContain("INF-0057-MARTEN");
  });

  it("reads one table row per line with cells joined by a bar", () => {
    render(
      <table>
        <tbody>
          <tr>
            <th>Name</th>
            <th>Qty</th>
          </tr>
          <tr>
            <td>Bolt</td>
            <td>4</td>
          </tr>
        </tbody>
      </table>,
    );
    const tree = agent({ action: "snapshot" }).tree ?? "";

    expect(tree).toContain('text "Name | Qty"');
    expect(tree).toContain('text "Bolt | 4"');
  });

  it("keeps a paragraph with inline content on one line", () => {
    render(
      <main>
        <p>
          Hello <b>world</b>
        </p>
        <div>
          <p>first</p>
          <p>second</p>
        </div>
      </main>,
    );
    const tree = agent({ action: "snapshot" }).tree ?? "";

    expect(tree).toContain('text "Hello world"');
    expect(tree).toContain('text "first"');
    expect(tree).toContain('text "second"');
  });
});

describe("scope resolves a ref, a selector or a heading", () => {
  function page() {
    return render(
      <main id="main">
        <h1>Account</h1>
        <form aria-label="Login">
          <button type="submit">Sign in</button>
        </form>
        <h2>Rediscovery details</h2>
        <p>Rediscovery body text</p>
        <h2>Later</h2>
        <p>Later body text</p>
      </main>,
    );
  }

  it("scopes to a CSS selector", () => {
    page();
    const tree = agent({ action: "snapshot", scope: "#main form" }).tree ?? "";

    expect(tree).toContain('form "Login"');
    expect(tree).toContain('button "Sign in"');
    expect(tree).not.toContain("Account");
  });

  it("scopes by heading text, exactly and then by prefix", () => {
    page();
    const exact = agent({ action: "snapshot", scope: "rediscovery details" }).tree ?? "";
    expect(exact).toContain('heading "Rediscovery details"');
    expect(exact).toContain('text "Rediscovery body text"');
    expect(exact).not.toContain("Later body text");

    const prefix = agent({ action: "snapshot", scope: "Rediscovery" }).tree ?? "";
    expect(prefix).toContain('heading "Rediscovery details"');
    expect(prefix).not.toContain("Later body text");
  });

  it("falls back from an invalid selector to a heading match", () => {
    render(
      <main>
        <h2>Section [1]</h2>
        <p>inside</p>
      </main>,
    );
    const tree = agent({ action: "snapshot", scope: "Section [1]" }).tree ?? "";

    expect(tree).toContain('heading "Section [1]"');
    expect(tree).toContain('text "inside"');
  });

  it("names the three forms when nothing matches", () => {
    page();
    const result = agent({ action: "snapshot", scope: "Nowhere" });

    expect(result.error).toContain("CSS selector");
    expect(result.error).toContain("heading");
  });
});

describe("headings mode", () => {
  it("outlines only headings with levels and group lines", () => {
    render(
      <main>
        <h1>Guide</h1>
        <h2>Setup</h2>
        <h3>Install</h3>
        <p>body text</p>
        <a href="/next">Next</a>
        <form aria-label="Search">
          <h2>Search</h2>
        </form>
      </main>,
    );
    const tree = agent({ action: "snapshot", headings: true }).tree ?? "";

    expect(tree).toContain('heading "Guide" (h1)');
    expect(tree).toContain('heading "Setup" (h2)');
    expect(tree).toContain('heading "Install" (h3)');
    expect(tree).toMatch(/form "Search" \[e\d+\]:/);
    expect(tree).not.toContain("body text");
    expect(tree).not.toContain('link "Next"');

    const lines = tree.split("\n");
    expect(lines.find((line) => line.includes('heading "Guide"'))).not.toMatch(/^ {2}/);
    expect(lines.find((line) => line.includes('heading "Setup"'))).toMatch(/^ {2}heading/);
    expect(lines.find((line) => line.includes('heading "Install"'))).toMatch(/^ {4}heading/);
  });
});
