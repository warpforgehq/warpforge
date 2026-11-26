import { act, cleanup, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ENTRY, agent, installPageAgent, page, refOf } from "./pageAgentHarness";

beforeAll(() => {
  installPageAgent();
});

afterEach(cleanup);

describe("page agent", () => {
  it("drives a React button with the pointer sequence, as untrusted events", () => {
    const seen: string[] = [];
    let trusted: boolean | null = null;
    function Page() {
      return (
        <button
          type="button"
          onPointerDown={() => seen.push("pointerdown")}
          onMouseDown={() => seen.push("mousedown")}
          onFocus={() => seen.push("focus")}
          onMouseUp={() => seen.push("mouseup")}
          onClick={(e) => {
            seen.push("click");
            trusted = e.nativeEvent.isTrusted;
          }}
        >
          Save
        </button>
      );
    }
    render(<Page />);
    const { tree = "" } = agent({ action: "snapshot" });
    const result = agent({ action: "click", ref: refOf(tree, '"Save"') });

    expect(result.error).toBeUndefined();
    expect(seen).toEqual(["pointerdown", "mousedown", "focus", "mouseup", "click"]);
    expect(trusted).toBe(false);
  });

  it("a site that insists on isTrusted ignores the click", () => {
    let handled = false;
    render(
      <button
        type="button"
        onClick={(e) => {
          if (e.nativeEvent.isTrusted) handled = true;
        }}
      >
        Pay
      </button>,
    );
    const { tree = "" } = agent({ action: "snapshot" });
    agent({ action: "click", ref: refOf(tree, '"Pay"') });
    expect(handled).toBe(false);
  });

  it("types into a controlled React input through the native setter", () => {
    const changes: string[] = [];
    function Page() {
      const [value, setValue] = useState("");
      return (
        <label>
          Email
          <input
            value={value}
            onChange={(e) => {
              changes.push(e.target.value);
              setValue(e.target.value);
            }}
          />
        </label>
      );
    }
    const { container } = render(<Page />);
    const { tree = "" } = agent({ action: "snapshot" });
    agent({ action: "type", ref: refOf(tree, 'textbox "Email"'), text: "a@b.co" });

    expect(changes).toEqual(["a@b.co"]);
    expect(container.querySelector("input")?.value).toBe("a@b.co");
  });

  it("assigning value directly is invisible to React, which is why the setter is used", () => {
    const changes: string[] = [];
    function Page() {
      const [value, setValue] = useState("");
      return (
        <input
          aria-label="plain"
          value={value}
          onChange={(e) => {
            changes.push(e.target.value);
            setValue(e.target.value);
          }}
        />
      );
    }
    const { container } = render(<Page />);
    const input = container.querySelector("input")!;
    act(() => {
      input.value = "typed";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(changes).toEqual([]);
  });

  it("submit presses Enter and submits the form; checkboxes toggle on click", () => {
    let submitted = 0;
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitted += 1;
        }}
      >
        <input aria-label="Search" defaultValue="" />
        <label>
          <input type="checkbox" /> Remember
        </label>
      </form>,
    );
    const { tree = "" } = agent({ action: "snapshot" });
    agent({ action: "type", ref: refOf(tree, '"Search"'), text: "q", submit: true });
    expect(submitted).toBe(1);

    const box = refOf(tree, "checkbox");
    agent({ action: "click", ref: box });
    const after = agent({ action: "snapshot" }).tree ?? "";
    expect(after).toContain(`[${box}] checked`);
  });

  it("outlines the page with stable refs, hides what is hidden, and names links", () => {
    render(
      <main>
        <h1>Dashboard</h1>
        <p>Welcome back</p>
        <a href="/settings">Settings</a>
        <button type="button" style={{ display: "none" }}>
          Secret
        </button>
        <select aria-label="Team" defaultValue="b">
          <option value="a">Alpha</option>
          <option value="b">Beta</option>
        </select>
      </main>,
    );
    const first = agent({ action: "snapshot" });
    const second = agent({ action: "snapshot" });
    const tree = first.tree ?? "";

    expect(tree).toContain('heading "Dashboard" (h1)');
    expect(tree).toContain('text "Welcome back"');
    expect(tree).toMatch(/link "Settings" \[e\d+\] → \/settings/);
    expect(tree).toContain('value="Beta" options: Alpha | Beta');
    expect(tree).not.toContain("Secret");
    expect(refOf(second.tree ?? "", '"Settings"')).toBe(refOf(tree, '"Settings"'));
  });

  it("a ref for an element that left the page is an error, not a click on something else", () => {
    const { unmount } = render(<button type="button">Gone</button>);
    const ref = refOf(agent({ action: "snapshot" }).tree ?? "", '"Gone"');
    unmount();
    expect(agent({ action: "click", ref }).error).toContain("take a new browser_snapshot");
  });

  it("keeps console messages and uncaught errors", () => {
    console.warn("disk almost full", { free: 3 });
    window.dispatchEvent(
      new ErrorEvent("error", { message: "boom", filename: "app.js", lineno: 4 }),
    );
    const messages = agent({ action: "console" }).messages ?? [];
    expect(messages).toContainEqual(
      expect.objectContaining({ level: "warn", text: 'disk almost full {"free":3}' }),
    );
    expect(messages).toContainEqual(
      expect.objectContaining({ level: "error", text: "Uncaught boom (app.js:4)" }),
    );
  });

  it("acts only in a document on an allowed origin, whatever the host was told", () => {
    let clicked = false;
    render(
      <button type="button" onClick={() => (clicked = true)}>
        Delete
      </button>,
    );
    const { tree = "" } = agent({ action: "snapshot" });
    const ref = refOf(tree, '"Delete"');

    const refused = agent({ action: "click", ref, allowed: ["http://localhost:4400"] });
    expect(refused.blocked).toBe(window.location.origin);
    expect(clicked).toBe(false);
    expect(agent({ action: "snapshot", allowed: [] }).tree).toBeUndefined();
    expect(agent({ action: "console", allowed: undefined }).blocked).toBe(window.location.origin);

    const report = agent({ action: "origin", allowed: [] });
    expect(report.blocked).toBeUndefined();
    expect(report.origin).toBe(window.location.origin);
  });

  it("joins inline text as written, without spacing out letters", () => {
    render(
      <main>
        <p>
          <span>T</span>
          <span>h</span>
          <span>i</span>
          <span>s</span> domain is <b>for</b> use
        </p>
        <p>
          one
          <br />
          two
        </p>
      </main>,
    );
    const tree = agent({ action: "snapshot" }).tree ?? "";
    expect(tree).toContain('text "This domain is for use"');
    expect(tree).toContain('text "one two"');
  });

  it("reads a plain text block as the browser lays it out", () => {
    const innerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "innerText");
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      configurable: true,
      get(this: HTMLElement) {
        return this.textContent?.toUpperCase() ?? "";
      },
    });
    try {
      render(<p>laid out</p>);
      expect(agent({ action: "snapshot" }).tree).toContain('text "LAID OUT"');
    } finally {
      if (innerText) Object.defineProperty(HTMLElement.prototype, "innerText", innerText);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).innerText;
    }
  });

  it("a page script cannot replace the entry point", () => {
    const original = page[ENTRY];
    try {
      page[ENTRY] = () => "{}";
    } catch {
      // Strict-mode assignment to a read-only property throws.
    }
    expect(page[ENTRY]).toBe(original);
  });

  it("interactive snapshots keep controls and headings but drop page text", () => {
    render(
      <main>
        <h1>Settings</h1>
        <p>Read this paragraph</p>
        <a href="/profile">Profile</a>
        <button type="button">Save</button>
        <label>
          Email
          <input />
        </label>
      </main>,
    );
    const tree = agent({ action: "snapshot", interactive: true }).tree ?? "";

    expect(tree).toContain('heading "Settings" (h1)');
    expect(tree).toMatch(/link "Profile" \[e\d+\]/);
    expect(tree).toContain('button "Save"');
    expect(tree).toContain('textbox "Email"');
    expect(tree).not.toContain("Read this paragraph");
    expect(tree).not.toContain('text "');
  });

  it("a scoped snapshot outlines one subtree only and refuses a stale ref", () => {
    const { unmount } = render(
      <main>
        <h1>Account</h1>
        <form aria-label="Login">
          <label>
            Email
            <input />
          </label>
          <button type="submit">Sign in</button>
        </form>
      </main>,
    );
    const full = agent({ action: "snapshot" }).tree ?? "";
    const scope = refOf(full, 'form "Login"');
    const tree = agent({ action: "snapshot", scope }).tree ?? "";

    expect(tree).toContain('form "Login"');
    expect(tree).toContain('textbox "Email"');
    expect(tree).toContain('button "Sign in"');
    expect(tree).not.toContain("Account");

    unmount();
    expect(agent({ action: "snapshot", scope }).error).toContain("take a new browser_snapshot");
  });

  it("a scoped heading outlines its section down to the next heading of the same level", () => {
    render(
      <main>
        <h2>A</h2>
        <p>alpha</p>
        <h3>A.1</h3>
        <p>nested</p>
        <h2>B</h2>
        <p>beta</p>
      </main>,
    );
    const full = agent({ action: "snapshot" }).tree ?? "";
    const scope = refOf(full, 'heading "A"');
    const tree = agent({ action: "snapshot", scope }).tree ?? "";

    expect(tree).toContain('heading "A"');
    expect(tree).toContain('text "alpha"');
    expect(tree).toContain('heading "A.1"');
    expect(tree).toContain('text "nested"');
    expect(tree).not.toContain('heading "B"');
    expect(tree).not.toContain('text "beta"');
  });

  it("climbs out of a heading wrapper so a Wikipedia section reads whole", () => {
    render(
      <main>
        <div className="mw-heading mw-heading2">
          <h2 id="Rediscovery">Rediscovery</h2>
          <span className="mw-editsection">
            <a href="/edit">edit</a>
          </span>
        </div>
        <p>Rediscovery body text</p>
        <div className="mw-heading mw-heading2">
          <h2 id="Later">Later</h2>
        </div>
        <p>Later body text</p>
      </main>,
    );
    const full = agent({ action: "snapshot" }).tree ?? "";
    const scope = refOf(full, 'heading "Rediscovery"');
    const tree = agent({ action: "snapshot", scope }).tree ?? "";

    expect(tree).toContain('heading "Rediscovery"');
    expect(tree).toContain('text "Rediscovery body text"');
    expect(tree).not.toContain('heading "Later"');
    expect(tree).not.toContain('text "Later body text"');
  });

  it("gives a heading the same ref in full, interactive and scoped snapshots", () => {
    render(
      <main>
        <p>Some page text</p>
        <h2>Section</h2>
        <button type="button">Go</button>
      </main>,
    );
    const full = agent({ action: "snapshot" }).tree ?? "";
    const interactive = agent({ action: "snapshot", interactive: true }).tree ?? "";
    const scope = refOf(full, 'heading "Section"');
    const scoped = agent({ action: "snapshot", scope }).tree ?? "";

    expect(refOf(interactive, 'heading "Section"')).toBe(scope);
    expect(refOf(scoped, 'heading "Section"')).toBe(scope);
  });

  it("a stale heading ref is a missing-ref error", () => {
    const { unmount } = render(
      <main>
        <h2>Gone section</h2>
        <p>text</p>
      </main>,
    );
    const ref = refOf(agent({ action: "snapshot" }).tree ?? "", 'heading "Gone section"');
    unmount();
    expect(agent({ action: "snapshot", scope: ref }).error).toContain(
      "take a new browser_snapshot",
    );
  });

  it("refs stay the same for the same element across snapshot modes", () => {
    render(
      <main>
        <p>Some page text</p>
        <a href="/next">Next</a>
      </main>,
    );
    const full = agent({ action: "snapshot" }).tree ?? "";
    const interactive = agent({ action: "snapshot", interactive: true }).tree ?? "";
    const scope = refOf(full, '"Next"');
    const scoped = agent({ action: "snapshot", scope }).tree ?? "";

    expect(refOf(interactive, '"Next"')).toBe(refOf(full, '"Next"'));
    expect(refOf(scoped, '"Next"')).toBe(refOf(full, '"Next"'));
  });

  it("truncates every snapshot mode at the same cap and says so", () => {
    render(
      <main>
        {Array.from({ length: 650 }, (_, i) => (
          <button type="button" key={i}>
            Action {i}
          </button>
        ))}
      </main>,
    );
    expect(agent({ action: "snapshot" }).truncated).toBe(true);
    expect(agent({ action: "snapshot", interactive: true }).truncated).toBe(true);
  });
});
