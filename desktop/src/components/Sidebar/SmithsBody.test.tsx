import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PeerMessage } from "@/protocol";
import { usePeersStore } from "@/store/peers";
import { useUi } from "@/store/ui";
import { setSmiths, smithFixture } from "@/test/smiths";

const unread = vi.hoisted(() => ({ value: 0 }));
vi.mock("@/hooks/useSmiths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useSmiths")>()),
  useSmithUnread: () => unread.value,
}));

import { SmithsBody } from "./SmithsBody";

const dmRecord: PeerMessage = {
  createdAt: 1,
  fromTask: "t_a",
  id: 3,
  project: "demo",
  status: "delivered",
  text: "hi",
  toTask: "t_b",
};

function show() {
  render(<SmithsBody projects={["demo", "api"]} tasks={[]} />);
}

describe("SmithsBody", () => {
  beforeEach(() => {
    unread.value = 0;
    setSmiths([]);
    usePeersStore.setState({ records: {} });
    useUi.setState({ openTaskId: null, teamSelection: null, view: "control" });
  });

  it("explains Smiths and offers the first one when there are none", async () => {
    show();
    expect(screen.getByText(/Smiths are your AI teammates/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create your first smith" }));
    expect(useUi.getState().teamSelection).toStrictEqual({ kind: "newTeammate" });
    expect(useUi.getState().view).toBe("team");
  });

  it("lists the Smiths first, then channels per project, then direct messages", async () => {
    unread.value = 2;
    setSmiths([
      smithFixture(),
      smithFixture({ held: ["paused"], id: "sm_2", name: "Grace", threadTaskId: "t_g" }),
    ]);
    usePeersStore.setState({ records: { 3: dmRecord } });
    show();

    const text = screen.getByRole("navigation", { name: "Smiths" }).textContent ?? "";
    expect(text.indexOf("Ada")).toBeLessThan(text.indexOf("Channels"));
    expect(text.indexOf("Channels")).toBeLessThan(text.indexOf("Direct messages"));
    expect(screen.getByRole("img", { name: "idle" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "held: paused" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("2 unread")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /New channel/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Grace/ }));
    expect(useUi.getState().teamSelection).toStrictEqual({ id: "sm_2", kind: "teammate" });
    await userEvent.click(screen.getAllByRole("button", { name: /general/ })[1]!);
    expect(useUi.getState().teamSelection).toStrictEqual({
      key: "api::team",
      kind: "conversation",
    });
    await userEvent.click(screen.getByRole("button", { name: /t_a ↔ t_b/ }));
    expect(useUi.getState().teamSelection).toMatchObject({ kind: "conversation" });
    await userEvent.click(screen.getByRole("button", { name: "New smith" }));
    expect(useUi.getState().teamSelection).toStrictEqual({ kind: "newTeammate" });
  });

  it("highlights the selection only while the Smiths area is showing", () => {
    setSmiths([smithFixture()]);
    useUi.setState({ teamSelection: { id: "sm_1", kind: "teammate" }, view: "control" });
    const { rerender } = render(<SmithsBody projects={["demo"]} tasks={[]} />);
    expect(screen.getByRole("button", { name: /Ada/ })).not.toHaveAttribute("aria-current");
    useUi.setState({ view: "team" });
    rerender(<SmithsBody projects={["demo"]} tasks={[]} />);
    expect(screen.getByRole("button", { name: /Ada/ })).toHaveAttribute("aria-current", "true");
  });
});
