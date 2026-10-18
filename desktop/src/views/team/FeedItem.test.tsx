import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { PeerMessage } from "@/protocol";

import { FeedItem } from "./FeedItem";

const label = (id: string | null | undefined) =>
  id ? (({ t_a: "Fix login", t_b: "Docs" } as Record<string, string>)[id] ?? id) : "You";

function record(overrides: Partial<PeerMessage>): PeerMessage {
  return {
    createdAt: 1_700_000_000,
    fromTask: "t_a",
    id: 7,
    project: "demo",
    status: "delivered",
    text: "can you review?",
    toTask: "t_b",
    ...overrides,
  };
}

function show(
  item: PeerMessage,
  onStartSession = vi.fn<(record: PeerMessage) => void>(),
  smith?: { id: string; name: string },
) {
  const onOpenTask = vi.fn<(id: string) => void>();
  render(
    <ul>
      <FeedItem
        record={item}
        label={label}
        onOpenTask={onOpenTask}
        onStartSession={onStartSession}
        smith={smith}
      />
    </ul>,
  );
  return { onOpenTask, onStartSession };
}

describe("FeedItem", () => {
  it("shows a refusal with its reason and opens either session", async () => {
    const { onOpenTask } = show(record({ reason: "pair window is full", status: "refused" }));
    expect(screen.getByText("Refused")).toBeTruthy();
    expect(screen.getByText("pair window is full")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(onOpenTask).toHaveBeenCalledWith("t_b");
  });

  it("renders the post as markdown", () => {
    show(
      record({
        status: "posted",
        text: "**done** with `cargo test`\n\n- one\n- two",
        toTask: undefined,
      }),
    );
    expect(document.querySelector("strong")?.textContent).toBe("done");
    expect(document.querySelector("code")?.textContent).toBe("cargo test");
    expect([...document.querySelectorAll("li li")].map((li) => li.textContent)).toEqual([
      "one",
      "two",
    ]);
  });

  it("highlights mentions in the Smith's colour, sessions neutrally, never in code", () => {
    render(
      <ul>
        <FeedItem
          record={record({
            status: "posted",
            text: "@Ada look at `@Ada` with @Docs, not @Nobody",
            toTask: undefined,
          })}
          label={label}
          onOpenTask={vi.fn<(id: string) => void>()}
          mentions={[
            { id: "t_ada", label: "Ada", smith: true },
            { id: "t_b", label: "Docs" },
          ]}
          smithColorOf={(id) => (id === "t_ada" ? 2 : undefined)}
        />
      </ul>,
    );
    const ada = document.querySelectorAll('[data-mention="t_ada"]');
    expect(ada).toHaveLength(1);
    expect(ada[0]!.textContent).toBe("@Ada");
    expect(ada[0]!.getAttribute("style")).toContain("hsl(var(--chart-3))");
    expect(ada[0]!.getAttribute("style")).toContain("hsl(var(--chart-3) / 0.15)");
    expect(document.querySelector("code")?.textContent).toBe("@Ada");
    expect(document.querySelector("code [data-mention]")).toBeNull();
    const docs = document.querySelector('[data-mention="t_b"]');
    expect(docs?.textContent).toBe("@Docs");
    expect(docs?.className).toContain("bg-secondary");
    expect(document.querySelectorAll("[data-mention]")).toHaveLength(2);
  });

  it("explains a held message", () => {
    show(record({ status: "held" }));
    expect(screen.getByText(/not running/)).toBeTruthy();
  });

  it("offers to start a session from the user's own post only", async () => {
    const post = record({ fromTask: undefined, status: "posted", toTask: undefined });
    const { onStartSession } = show(post);
    await userEvent.click(screen.getByRole("button", { name: "Start a session" }));
    expect(onStartSession).toHaveBeenCalledWith(post);
  });

  it("shows the Smith's avatar on its thread's post", () => {
    show(record({ status: "posted", toTask: undefined }), undefined, { id: "sm_1", name: "Ada" });
    expect(screen.getByRole("img", { name: "Ada" })).toBeTruthy();
  });

  it("has no start action on an agent's post", () => {
    show(record({ status: "posted", toTask: undefined }));
    expect(screen.queryByRole("button", { name: "Start a session" })).toBeNull();
  });

  it("lists who a user's post was handed to", async () => {
    const { onOpenTask } = show(
      record({ fromTask: undefined, mentions: ["t_b"], status: "posted", toTask: undefined }),
    );
    expect(screen.getByText("Handed to")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Docs" }));
    expect(onOpenTask).toHaveBeenCalledWith("t_b");
  });

  it("renders a started line with a link to the new session", async () => {
    const { onOpenTask } = show(
      record({ fromTask: undefined, startedTask: "t_a", status: "posted", toTask: undefined }),
    );
    expect(screen.getByText("You started")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Fix login" }));
    expect(onOpenTask).toHaveBeenCalledWith("t_a");
  });
});
