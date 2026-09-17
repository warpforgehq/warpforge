import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SurfaceRail, type SurfaceRailProps } from "./SurfaceRail";
import { DEFAULT_SURFACE_TABS, type SurfaceTab } from "./SurfaceTabs";

const REDUCE = "(prefers-reduced-motion: reduce)";

function media(...matching: string[]) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => {},
      matches: matching.includes(query),
      media: query,
      removeEventListener: () => {},
    }),
    writable: true,
  });
}

const RAIL_WIDTH = 28;
const ITEM = 28;
const GAP = 2;
const PITCH = ITEM + GAP;

/** A `w-7` rail at the origin holding flush `size-7` items stacked with `gap-1`. */
function geometry() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.getAttribute("role") === "toolbar") {
        return { height: 400, left: 0, top: 0, width: RAIL_WIDTH } as DOMRect;
      }
      const index = this.dataset.railKey ? keys.indexOf(this.dataset.railKey) : -1;
      if (index < 0) return { height: 0, left: 0, top: 0, width: 0 } as DOMRect;
      return { height: ITEM, left: 0, top: index * PITCH, width: ITEM } as DOMRect;
    },
  );
}

const at = (key: string) => `translate3d(0px, ${keys.indexOf(key) * PITCH}px, 0)`;

function pillOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>("[data-rail-pill]")!;
}

/** Every value written to the chip's `transition`, in order. */
function recordTransitions(pill: HTMLElement) {
  const writes: string[] = [];
  const style = pill.style;
  const native = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(style), "transition")!;
  Object.defineProperty(style, "transition", {
    configurable: true,
    get: () => native.get!.call(style),
    set: (value: string) => {
      writes.push(value);
      native.set!.call(style, value);
    },
  });
  return writes;
}

const keys = ["conversation", ...DEFAULT_SURFACE_TABS.map((tab) => `surface:${tab.id}`)];

function renderRail(props: Partial<SurfaceRailProps> = {}) {
  const onSurfaceChange = vi.fn<SurfaceRailProps["onSurfaceChange"]>();
  const onConversation = vi.fn<SurfaceRailProps["onConversation"]>();
  const view = render(
    <SurfaceRail
      tabs={DEFAULT_SURFACE_TABS}
      activeSurface="diff"
      onSurfaceChange={onSurfaceChange}
      chatVisible
      surfaceVisible
      onConversation={onConversation}
      {...props}
    />,
  );
  return { onConversation, onSurfaceChange, view };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "matchMedia");
});

describe("SurfaceRail", () => {
  it("is the only switcher: one toolbar of the conversation plus every surface", () => {
    renderRail();

    const rail = screen.getByRole("toolbar", { name: "Workspace rail" });
    expect(rail).toHaveAttribute("aria-orientation", "vertical");
    expect(within(rail).getAllByRole("button")).toHaveLength(DEFAULT_SURFACE_TABS.length + 1);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("speaks the live count in the label and marks the open surface", () => {
    const tabs: SurfaceTab[] = DEFAULT_SURFACE_TABS.map((tab) =>
      tab.id === "diff" ? { ...tab, count: 3 } : tab,
    );
    renderRail({ tabs });

    const diff = screen.getByRole("button", { name: "Diff, 3 changed files · ⌘3" });
    expect(diff).toHaveAttribute("aria-current", "page");
    const current = screen
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
  });

  it("draws no count badges, leaving the number to the label and the peek", () => {
    const tabs: SurfaceTab[] = DEFAULT_SURFACE_TABS.map((tab) =>
      tab.id === "diff" ? { ...tab, count: 120 } : tab,
    );
    const { view } = renderRail({ tabs });

    expect(view.container.querySelector("[data-rail-count]")).toBeNull();
    const diff = screen.getByRole("button", { name: /^Diff/ });
    expect(diff).toHaveAccessibleName(/120 changed files/);
    expect(diff.textContent).not.toMatch(/^120/);
    expect(diff.querySelector("svg")).not.toHaveClass("-translate-y-[4px]");
  });

  it("keeps one tab stop and moves focus with the arrow keys", async () => {
    renderRail();

    const buttons = screen.getAllByRole("button");
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/Conversation/);

    buttons[0].focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(buttons[1]);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  describe("chat focus", () => {
    const chatFocus = { chatVisible: true, surfaceVisible: false } as const;

    it("ghosts the remembered surface and parks the pill on the conversation", () => {
      const tabs: SurfaceTab[] = DEFAULT_SURFACE_TABS.map((tab) =>
        tab.id === "diff" ? { ...tab, count: 3 } : tab,
      );
      renderRail({ ...chatFocus, tabs });

      const diff = screen.getByRole("button", { name: /^Diff/ });
      expect(diff).toHaveAttribute("data-rail-ghost", "");
      expect(diff).not.toHaveAttribute("aria-current");
      expect(diff).toHaveClass("text-foreground/80");
      expect(diff.className).not.toMatch(/(^|\s)bg-/);
      expect(screen.getByRole("button", { name: /Conversation/ })).toHaveAttribute(
        "aria-current",
        "page",
      );
    });

    it("restores the split when a surface is clicked", async () => {
      const { onSurfaceChange } = renderRail(chatFocus);

      await userEvent.click(screen.getByRole("button", { name: /^Runtime/ }));

      expect(onSurfaceChange).toHaveBeenCalledWith("runtime");
    });

    it("stays a bare strip so the rail reads as chrome, not a second pane", () => {
      renderRail(chatFocus);
      const rail = screen.getByRole("toolbar");

      expect(rail.className).not.toMatch(/\bbg-/);
      expect(rail.className).not.toContain("rounded");
      expect(rail.className).not.toMatch(/\bborder\b/);
    });
  });

  it("ghosts the conversation while the workspace owns the split", () => {
    renderRail({ chatVisible: false, surfaceVisible: true });

    expect(screen.getByRole("button", { name: /Conversation/ })).toHaveAttribute(
      "data-rail-ghost",
      "",
    );
    expect(screen.getByRole("button", { name: /^Diff/ })).toHaveAttribute("aria-current", "page");
  });

  describe("geometry", () => {
    it("is exactly one button wide, with no vertical padding and a tight stack", () => {
      renderRail();
      const tokens = screen.getByRole("toolbar").className.split(/\s+/);

      expect(tokens).toContain("w-7");
      expect(tokens).toContain("gap-1");
      expect(tokens.filter((token) => /^(p|py|pt|pb|px)-/.test(token))).toEqual([]);
      for (const button of screen.getAllByRole("button")) expect(button).toHaveClass("size-7");
    });

    it("puts nothing between the conversation and the surfaces", () => {
      renderRail();
      const children = Array.from(screen.getByRole("toolbar").children).filter(
        (child) => !child.hasAttribute("data-rail-pill") && !child.classList.contains("flex-1"),
      );

      expect(children).toHaveLength(DEFAULT_SURFACE_TABS.length + 1);
      expect(children.every((child) => child.hasAttribute("data-rail-item"))).toBe(true);
    });
  });

  describe("the travelling chip", () => {
    it("is a background behind the buttons, in the active fill colour", () => {
      const { view } = renderRail();
      const pill = pillOf(view.container);

      expect(pill).toHaveAttribute("aria-hidden", "true");
      for (const token of ["rounded-md", "bg-primary", "z-0", "pointer-events-none"]) {
        expect(pill).toHaveClass(token);
      }
      expect(pill).not.toHaveClass("w-0.5");
      expect(pill).not.toHaveClass("bg-accent/60");
      for (const button of screen.getAllByRole("button")) {
        expect(button).toHaveClass("relative");
        expect(button).toHaveClass("z-10");
      }
    });

    it("moves only by transform, on the fold curve", () => {
      const { view } = renderRail();
      const tokens = pillOf(view.container).className.split(/\s+/);

      expect(tokens).toContain("transition-transform");
      expect(tokens).toContain("duration-[180ms]");
      expect(tokens).toContain("ease-[var(--ease-fold)]");
    });

    it("takes its position and size from the active item's rect", () => {
      geometry();
      const { view } = renderRail();
      const pill = pillOf(view.container);

      expect(pill).toHaveStyle({
        height: `${ITEM}px`,
        opacity: "1",
        transform: at("surface:diff"),
        width: `${ITEM}px`,
      });
    });

    it("follows whatever size the item resolves to", () => {
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
        function (this: HTMLElement) {
          if (this.getAttribute("role") === "toolbar") {
            return { height: 400, left: 10, top: 20, width: 40 } as DOMRect;
          }
          if (this.dataset.railKey === "surface:diff") {
            return { height: 36, left: 12, top: 100, width: 36 } as DOMRect;
          }
          return { height: 0, left: 0, top: 0, width: 0 } as DOMRect;
        },
      );
      const { view } = renderRail();

      expect(pillOf(view.container)).toHaveStyle({
        height: "36px",
        transform: "translate3d(2px, 80px, 0)",
        width: "36px",
      });
    });

    it("moves to whichever item the pane hands the split to", () => {
      geometry();
      const { view } = renderRail({ chatVisible: true, surfaceVisible: false });

      expect(pillOf(view.container)).toHaveStyle({ transform: at("conversation") });
    });

    it("travels under its own curve once it has been placed", () => {
      geometry();
      const { view } = renderRail();
      const pill = pillOf(view.container);
      expect(pill.style.transition).toBe("");

      view.rerender(
        <SurfaceRail
          tabs={DEFAULT_SURFACE_TABS}
          activeSurface="runtime"
          onSurfaceChange={vi.fn<SurfaceRailProps["onSurfaceChange"]>()}
          chatVisible
          surfaceVisible
          onConversation={vi.fn<SurfaceRailProps["onConversation"]>()}
        />,
      );

      expect(pill.style.transition).toBe("");
      expect(pill).toHaveStyle({ transform: at("surface:runtime") });
    });

    it("snaps with no trip at all when motion is reduced", () => {
      media(REDUCE);
      geometry();
      const { view } = renderRail();

      const pill = pillOf(view.container);
      expect(pill.style.transition).toBe("none");
      expect(pill).toHaveStyle({ transform: at("surface:diff") });
    });

    it("snaps on keyboard activation, then restores its curve", () => {
      geometry();
      const onSurfaceChange = vi.fn<SurfaceRailProps["onSurfaceChange"]>();
      const props = {
        chatVisible: true,
        onConversation: vi.fn<SurfaceRailProps["onConversation"]>(),
        onSurfaceChange,
        surfaceVisible: true,
        tabs: DEFAULT_SURFACE_TABS,
      };
      const view = render(<SurfaceRail {...props} activeSurface="diff" />);
      const pill = pillOf(view.container);
      const transitions = recordTransitions(pill);

      fireEvent.keyDown(window, { key: "4", metaKey: true });
      const target = DEFAULT_SURFACE_TABS[2].id;
      expect(onSurfaceChange).toHaveBeenCalledWith(target);
      view.rerender(<SurfaceRail {...props} activeSurface={target} />);

      expect(transitions).toEqual(["none", ""]);
      expect(pill).toHaveStyle({ transform: at(`surface:${target}`) });
    });

    it("snaps when the rail is resized", () => {
      geometry();
      const original = globalThis.ResizeObserver;
      let resize: ResizeObserverCallback = () => {};
      globalThis.ResizeObserver = class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      try {
        const { view } = renderRail();
        const pill = pillOf(view.container);
        const transitions = recordTransitions(pill);

        resize([], {} as ResizeObserver);

        expect(transitions).toEqual(["none", ""]);
        expect(pill).toHaveStyle({ transform: at("surface:diff") });
      } finally {
        globalThis.ResizeObserver = original;
      }
    });

    it("hides when the target item is missing", () => {
      const { view } = renderRail({ tabs: [], surfaceVisible: true });

      expect(pillOf(view.container)).toHaveStyle({ opacity: "0" });
    });
  });

  describe("hover peek", () => {
    it("gives every item its own card, anchored to the item itself", () => {
      const tabs: SurfaceTab[] = DEFAULT_SURFACE_TABS.map((tab) =>
        tab.id === "diff" ? { ...tab, count: 3 } : tab,
      );
      renderRail({ tabs });

      const diff = screen.getByRole("button", { name: /^Diff/ });
      const card = diff.querySelector("[data-surface-peek]");
      // A card inside its own button cannot show another item's summary, which
      // is what a single shared card reached through pointer state could do.
      expect(card).toHaveTextContent("3 changed files");
      expect(card).toHaveTextContent("⌘3");
      expect(card).toHaveAttribute("aria-hidden", "true");
      expect(card?.className).toContain("pointer-events-none");
      expect(card?.className).toContain("opacity-0");
      expect(card?.className).toContain("group-hover:opacity-100");
      expect(card?.className).toContain("group-focus-visible:opacity-100");

      const explorer = screen.getByRole("button", { name: /^Explorer/ });
      expect(explorer.querySelector("[data-surface-peek]")).toHaveTextContent(
        "Project tree and editor",
      );
    });

    it("keeps the card hidden until the group is hovered or focused, in CSS", () => {
      renderRail();
      const cards = document.querySelectorAll("[data-surface-peek]");
      expect(cards).toHaveLength(DEFAULT_SURFACE_TABS.length + 1);
      for (const card of cards) {
        const tokens = card.className.split(/\s+/);
        expect(tokens).toContain("delay-150");
        expect(tokens).toContain("opacity-0");
        expect(tokens).not.toContain("opacity-100");
      }
    });
  });

  it("marks the active surface by icon colour alone, leaving the fill to the chip", () => {
    renderRail();
    const diff = screen.getByRole("button", { name: /^Diff/ });

    expect(diff).toHaveClass("text-primary-foreground");
    expect(diff).not.toHaveClass("bg-accent/60");
    expect(screen.getByRole("button", { name: /^Explorer/ })).toHaveClass("hover:bg-accent/40");
  });

  it("suppresses the focus ring after pointer activation", () => {
    const { view } = renderRail();
    const diff = screen.getByRole("button", { name: /^Diff/ });
    fireEvent.pointerDown(diff);
    expect(diff).toHaveAttribute("data-pointer-focus", "true");
    expect(diff.className).toContain("data-[pointer-focus=true]:focus-visible:ring-0");
    expect(view.container.querySelector('[role="status"]')).toBeNull();
  });
});
