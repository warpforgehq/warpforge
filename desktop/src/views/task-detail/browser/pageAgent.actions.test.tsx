import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { agent, installPageAgent, refOf } from "./pageAgentHarness";

beforeAll(() => {
  installPageAgent();
});

afterEach(cleanup);

const find = (changes: string[] | undefined, re: RegExp): string | undefined =>
  changes?.find((c) => re.test(c));
const refOfLine = (changes: string[] | undefined, re: RegExp): string | undefined =>
  changes?.map((c) => c.match(re)?.[1]).find(Boolean);

function refOfButton(label: string): string {
  const tree = agent({ action: "snapshot", interactive: true }).tree ?? "";
  return refOf(tree, `button "${label}"`);
}

/** Append `html` as a portal at the end of body and return the element. */
function portal(html: string): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  document.body.appendChild(holder);
  return holder;
}

describe("click and type report what changed", () => {
  it("reports a status message a click filled", () => {
    render(
      <button
        type="button"
        onClick={() => {
          const region = document.createElement("div");
          region.setAttribute("role", "status");
          region.textContent = "Saved to draft";
          document.body.appendChild(region);
        }}
      >
        Save
      </button>,
    );
    const ref = refOfButton("Save");

    const changes = agent({ action: "click", ref }).changes;

    expect(find(changes, /^status "Saved to draft" \[e\d+\]$/)).toBeDefined();
    document.body.querySelector('[role="status"]')?.remove();
  });

  it("reports a dialog opening, with its outline, and then closing", () => {
    render(
      <button
        type="button"
        onClick={() => {
          const dialog = portal(
            '<div role="dialog" aria-label="Confirm"><p>Are you sure?</p>' +
              '<button type="button">Close</button></div>',
          );
          dialog.querySelector("button")?.addEventListener("click", () => dialog.remove());
        }}
      >
        Open
      </button>,
    );
    const opener = refOfButton("Open");

    const opened = agent({ action: "click", ref: opener }).changes ?? [];
    const dialogLine = find(opened, /^dialog "Confirm" \[e\d+\] opened/);
    expect(dialogLine).toBeDefined();
    const closer = refOfLine(opened, /button "Close" \[(e\d+)\]/);
    expect(closer).toBeDefined();

    const closed = agent({ action: "click", ref: closer! }).changes ?? [];
    expect(find(closed, /^dialog "Confirm" \[e\d+\] closed$/)).toBeDefined();
  });

  it("reports a status message a typing submit changed", () => {
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const region = document.createElement("div");
          region.setAttribute("role", "status");
          region.textContent = "Saved!";
          document.body.appendChild(region);
        }}
      >
        <input aria-label="Name" />
        <button type="submit">Save</button>
      </form>,
    );
    const field = refOf(
      agent({ action: "snapshot", interactive: true }).tree ?? "",
      'textbox "Name"',
    );

    const changes = agent({ action: "type", ref: field, text: "Ada", submit: true }).changes;

    expect(find(changes, /^status "Saved!" \[e\d+\]$/)).toBeDefined();
    document.body.querySelector('[role="status"]')?.remove();
  });

  it("reports nothing when a click changes nothing", () => {
    render(
      <button type="button" onClick={() => {}}>
        Save
      </button>,
    );
    const ref = refOfButton("Save");

    expect(agent({ action: "click", ref }).changes).toEqual([]);
  });

  it("does not report a status message that was already there", () => {
    render(
      <>
        <div role="status">Ready</div>
        <button type="button">
          Save
        </button>
      </>,
    );
    const ref = refOfButton("Save");

    expect(agent({ action: "click", ref }).changes).toEqual([]);
  });
});

describe("dialogs, menus and toasts from components", () => {
  it("opens an alertdialog on a form submit and needs no snapshot to press OK", () => {
    render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const dialog = portal(
            '<div role="alertdialog" aria-label="Delete item" aria-modal="true">' +
              '<div role="status">Item deleted</div>' +
              '<button type="button">OK</button></div>',
          );
          dialog.querySelector("button")?.addEventListener("click", () => dialog.remove());
        }}
      >
        <input aria-label="Item" />
        <button type="submit">Delete</button>
      </form>,
    );
    const field = refOf(
      agent({ action: "snapshot", interactive: true }).tree ?? "",
      'textbox "Item"',
    );

    const changes = agent({ action: "type", ref: field, text: "old note", submit: true }).changes ?? [];

    expect(find(changes, /^dialog "Delete item" \[e\d+\] opened/)).toBeDefined();
    expect(find(changes, /^status "Item deleted" \[e\d+\]$/)).toBeDefined();
    const ok = refOfLine(changes, /button "OK" \[(e\d+)\]/);
    expect(ok).toBeDefined();

    const closed = agent({ action: "click", ref: ok! }).changes ?? [];
    expect(find(closed, /^dialog "Delete item" \[e\d+\] closed$/)).toBeDefined();
  });

  it("reports a menu a pointerdown handler opened at the end of body", () => {
    render(
      <button
        type="button"
        onPointerDown={() => {
          portal(
            '<div role="menu" aria-label="Actions" data-state="open">' +
              '<button type="button">Rename</button></div>',
          );
        }}
      >
        Open menu
      </button>,
    );

    const changes = agent({ action: "click", ref: refOfButton("Open menu") }).changes ?? [];
    expect(find(changes, /^menu "Actions" \[e\d+\] opened/)).toBeDefined();
    expect(find(changes, /button "Rename" \[e\d+\]/)).toBeDefined();
    document.body.querySelector('[role="menu"]')?.parentElement?.remove();
  });

  it("reports a Radix toast rendered as li[role=status] inside an ol", () => {
    render(
      <button
        type="button"
        onClick={() => portal('<ol><li role="status">Saved successfully</li></ol>')}
      >
        Save
      </button>,
    );

    const changes = agent({ action: "click", ref: refOfButton("Save") }).changes ?? [];
    expect(find(changes, /^status "Saved successfully" \[e\d+\]$/)).toBeDefined();
    document.body.querySelector("ol")?.remove();
  });

  it("reports a Sonner toast inside the Notifications live section", () => {
    render(
      <button
        type="button"
        onClick={() =>
          portal('<section aria-live="polite" aria-label="Notifications"><div>Your changes were saved</div></section>')
        }
      >
        Save
      </button>,
    );

    const changes = agent({ action: "click", ref: refOfButton("Save") }).changes ?? [];
    expect(find(changes, /^status "Your changes were saved" \[e\d+\]$/)).toBeDefined();
    document.body.querySelector("section")?.remove();
  });

  it("reports a dialog inside a hidden wrapper once the click shows it", () => {
    render(
      <>
        <button
          type="button"
          onClick={() => {
            const backdrop = document.getElementById("backdrop");
            if (backdrop) backdrop.style.display = "block";
          }}
        >
          Edit shipping address
        </button>
        <div id="backdrop" style={{ display: "none" }}>
          <div role="dialog" aria-label="Edit shipping address">
            <p>Change your address.</p>
            <button type="button">Close</button>
          </div>
        </div>
      </>,
    );

    const changes =
      agent({ action: "click", ref: refOfButton("Edit shipping address") }).changes ?? [];

    expect(find(changes, /^dialog "Edit shipping address" \[e\d+\] opened/)).toBeDefined();
    expect(find(changes, /button "Close" \[e\d+\]/)).toBeDefined();
  });

  it("reports a status region inside a hidden wrapper once the click shows it", () => {
    render(
      <>
        <button
          type="button"
          onClick={() => {
            const wrap = document.getElementById("wrap");
            if (wrap) wrap.style.display = "block";
            const region = document.getElementById("saved");
            if (region) region.textContent = "Saved to draft";
          }}
        >
          Save
        </button>
        <div id="wrap" style={{ display: "none" }}>
          <div id="saved" role="status" />
        </div>
      </>,
    );

    const changes = agent({ action: "click", ref: refOfButton("Save") }).changes ?? [];

    expect(find(changes, /^status "Saved to draft" \[e\d+\]$/)).toBeDefined();
  });

  it("reports a listbox a click opened", () => {
    render(
      <button
        type="button"
        onClick={() =>
          portal('<div role="listbox" data-state="open"><div role="option">Apple</div></div>')
        }
      >
        Pick fruit
      </button>,
    );

    const changes = agent({ action: "click", ref: refOfButton("Pick fruit") }).changes ?? [];
    expect(find(changes, /^listbox \[e\d+\] opened/)).toBeDefined();
    expect(find(changes, /option "Apple" \[e\d+\]/)).toBeDefined();
    document.body.querySelector('[role="listbox"]')?.parentElement?.remove();
  });
});
