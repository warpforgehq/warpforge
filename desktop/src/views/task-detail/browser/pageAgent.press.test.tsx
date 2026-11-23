import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { agent, installPageAgent, refOf } from "./pageAgentHarness";

beforeAll(() => {
  installPageAgent();
});

afterEach(cleanup);

function portal(html: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  document.body.appendChild(holder);
  return holder;
}

describe("browser_press", () => {
  it("Escape closes a dialog whose listener is on document and says so", () => {
    const holder = portal('<div role="dialog" aria-label="Settings"><button>Close</button></div>');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") holder.remove();
    };
    document.addEventListener("keydown", onKey);
    try {
      const tree = agent({ action: "snapshot", interactive: true }).tree ?? "";
      const ref = refOf(tree, 'dialog "Settings"');

      const changes = agent({ action: "press", key: "Escape", ref }).changes ?? [];

      expect(changes.find((c) => /^dialog "Settings" \[e\d+\] closed$/.test(c))).toBeDefined();
    } finally {
      document.removeEventListener("keydown", onKey);
      holder.remove();
    }
  });

  it("Tab and Shift+Tab move focus in DOM order", () => {
    render(
      <>
        <button type="button">First</button>
        <button type="button">Second</button>
        <button type="button">Third</button>
      </>,
    );
    const tree = agent({ action: "snapshot", interactive: true }).tree ?? "";
    const first = refOf(tree, 'button "First"');
    const second = refOf(tree, 'button "Second"');

    agent({ action: "press", key: "Tab", ref: first });
    expect(document.activeElement?.textContent).toBe("Second");

    agent({ action: "press", key: "Shift+Tab" });
    expect(document.activeElement?.textContent).toBe("First");

    agent({ action: "press", key: "Shift+Tab", ref: second });
    expect(document.activeElement?.textContent).toBe("First");
  });

  it("Enter on a single-line field submits its form", () => {
    let submitted = false;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <input aria-label="Name" />
      </form>,
    );
    const tree = agent({ action: "snapshot", interactive: true }).tree ?? "";
    const field = refOf(tree, 'textbox "Name"');

    agent({ action: "press", key: "Enter", ref: field });

    expect(submitted).toBe(true);
  });

  it("Space toggles a checkbox", () => {
    render(
      <label>
        Accept
        <input type="checkbox" aria-label="Accept" />
      </label>,
    );
    const tree = agent({ action: "snapshot", interactive: true }).tree ?? "";
    const box = refOf(tree, 'checkbox "Accept"');
    const input = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

    agent({ action: "press", key: "Space", ref: box });

    expect(input.checked).toBe(true);
  });
});
