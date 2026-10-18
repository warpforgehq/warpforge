import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { postToTeam, messageSession } = vi.hoisted(() => ({
  messageSession: vi.fn<(taskId: string, text: string) => Promise<unknown>>(async () => ({
    relation: "peer",
  })),
  postToTeam: vi.fn<(project: string, text: string, channelId?: string) => Promise<unknown>>(
    async () => ({
      relation: "team",
    }),
  ),
}));
vi.mock("@/daemon", () => ({ daemon: { messageSession, postToTeam } }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn<() => void>(), { error: vi.fn<() => void>() }),
}));

import { TeamComposer } from "./TeamComposer";

const candidates = [
  { id: "t_11111111", label: "Fix login" },
  { id: "t_22222222", label: "Docs" },
];

describe("TeamComposer", () => {
  beforeEach(() => {
    postToTeam.mockClear();
    messageSession.mockClear();
  });

  it("completes an @mention and posts to the project's channel", async () => {
    render(
      <TeamComposer
        project="demo"
        candidates={candidates}
        onStartSession={vi.fn<(text: string) => void>()}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Post to the channel" });
    await userEvent.type(box, "@fix");
    expect(screen.getByRole("option", { name: /Fix login/ })).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    await userEvent.type(box, "take the bug{Enter}");
    expect(postToTeam).toHaveBeenCalledWith("demo", "@Fix login take the bug", undefined);
  });

  it("messages the picked session of a direct thread", async () => {
    render(
      <TeamComposer
        project="demo"
        candidates={candidates}
        targets={candidates}
        onStartSession={vi.fn<(text: string) => void>()}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Docs" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "ship it{Enter}");
    expect(messageSession).toHaveBeenCalledWith("t_22222222", "ship it");
    expect(postToTeam).not.toHaveBeenCalled();
  });

  it("keeps both actions inside the box, idle until there is text", async () => {
    render(
      <TeamComposer
        project="demo"
        candidates={candidates}
        onStartSession={vi.fn<(text: string) => void>()}
      />,
    );
    const start = screen.getByRole("button", { name: "Start a session with this text" });
    const post = screen.getByRole("button", { name: "Post" });
    expect(start).toHaveProperty("disabled", true);
    expect(post).toHaveProperty("disabled", true);
    await userEvent.type(screen.getByRole("textbox"), "hello");
    expect(start).toHaveProperty("disabled", false);
    expect(post).toHaveProperty("disabled", false);
    expect(start.getAttribute("title")).toBe("Start a session with this text");
  });

  it("hands the text to New Task to start a session", async () => {
    const onStartSession = vi.fn<(text: string) => void>();
    render(<TeamComposer project="demo" candidates={candidates} onStartSession={onStartSession} />);
    await userEvent.type(screen.getByRole("textbox"), "write the docs");
    await userEvent.click(screen.getByRole("button", { name: "Start a session with this text" }));
    expect(onStartSession).toHaveBeenCalledWith("write the docs");
  });
});

describe("TeamComposer mention hints", () => {
  beforeEach(() => postToTeam.mockClear());

  it("warns about an @word that names nobody, then posts it as text on the second send", async () => {
    render(
      <TeamComposer
        project="demo"
        candidates={candidates}
        onStartSession={vi.fn<(text: string) => void>()}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Post to the channel" });
    await userEvent.type(box, "ask @Docz now{Enter}");
    expect(postToTeam).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("@Docz matches no session");
    await userEvent.keyboard("{Enter}");
    expect(postToTeam).toHaveBeenCalledWith("demo", "ask @Docz now", undefined);
  });

  it("does not send a mention two sessions share", async () => {
    render(
      <TeamComposer
        project="demo"
        candidates={[...candidates, { id: "t_33333333", label: "Docs" }]}
        onStartSession={vi.fn<(text: string) => void>()}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Post to the channel" });
    await userEvent.type(box, "x (@Docs){Escape}{Enter}{Enter}");
    expect(postToTeam).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("more than one session");
  });
});

describe("TeamComposer with smiths", () => {
  beforeEach(() => postToTeam.mockClear());

  it("offers a smith by name and inserts @Name", async () => {
    render(
      <TeamComposer
        project="demo"
        candidates={[...candidates, { id: "t_thread", label: "Ada", smith: true }]}
        onStartSession={vi.fn<(text: string) => void>()}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Post to the channel" });
    await userEvent.type(box, "@ad");
    const option = screen.getByRole("option", { name: /Ada/ });
    expect(option.textContent).toContain("smith");
    await userEvent.keyboard("{Enter}");
    await userEvent.type(box, "check CI{Enter}");
    expect(postToTeam).toHaveBeenCalledWith("demo", "@Ada check CI", undefined);
  });
});

describe("TeamComposer in a named channel", () => {
  beforeEach(() => postToTeam.mockClear());

  it("posts to that channel", async () => {
    render(
      <TeamComposer
        project="demo"
        channel={{ createdAt: 1, id: "c1", members: [], name: "ci", project: "demo" }}
        candidates={candidates}
        onStartSession={vi.fn<(text: string) => void>()}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Post to the channel" });
    expect(box.getAttribute("placeholder")).toContain("#ci");
    await userEvent.type(box, "main is red{Enter}");
    expect(postToTeam).toHaveBeenCalledWith("demo", "main is red", "c1");
  });
});
