import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { postToTeam, messageSession } = vi.hoisted(() => ({
  messageSession: vi.fn<(taskId: string, text: string) => Promise<unknown>>(async () => ({
    relation: "peer",
  })),
  postToTeam: vi.fn<(project: string, text: string) => Promise<unknown>>(async () => ({
    relation: "team",
  })),
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
    const box = screen.getByRole("textbox", { name: "Post to the team" });
    await userEvent.type(box, "@fix");
    expect(screen.getByRole("option", { name: /Fix login/ })).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    await userEvent.type(box, "take the bug{Enter}");
    expect(postToTeam).toHaveBeenCalledWith("demo", "@Fix login take the bug");
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

  it("hands the text to New Task to start a session", async () => {
    const onStartSession = vi.fn<(text: string) => void>();
    render(<TeamComposer project="demo" candidates={candidates} onStartSession={onStartSession} />);
    await userEvent.type(screen.getByRole("textbox"), "write the docs");
    await userEvent.click(screen.getByRole("button", { name: "Start a session" }));
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
    const box = screen.getByRole("textbox", { name: "Post to the team" });
    await userEvent.type(box, "ask @Docz now{Enter}");
    expect(postToTeam).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("@Docz matches no session");
    await userEvent.keyboard("{Enter}");
    expect(postToTeam).toHaveBeenCalledWith("demo", "ask @Docz now");
  });

  it("does not send a mention two sessions share", async () => {
    render(
      <TeamComposer
        project="demo"
        candidates={[...candidates, { id: "t_33333333", label: "Docs" }]}
        onStartSession={vi.fn<(text: string) => void>()}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Post to the team" });
    await userEvent.type(box, "x (@Docs){Escape}{Enter}{Enter}");
    expect(postToTeam).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("more than one session");
  });
});

describe("TeamComposer with teammates", () => {
  beforeEach(() => postToTeam.mockClear());

  it("offers a teammate by name and inserts @Name", async () => {
    render(
      <TeamComposer
        project="demo"
        candidates={[...candidates, { id: "t_thread", label: "Ada", smith: true }]}
        onStartSession={vi.fn<(text: string) => void>()}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Post to the team" });
    await userEvent.type(box, "@ad");
    const option = screen.getByRole("option", { name: /Ada/ });
    expect(option.textContent).toContain("teammate");
    await userEvent.keyboard("{Enter}");
    await userEvent.type(box, "check CI{Enter}");
    expect(postToTeam).toHaveBeenCalledWith("demo", "@Ada check CI");
  });
});
