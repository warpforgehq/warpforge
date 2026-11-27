import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SessionUpdate } from "../protocol";
import { StreamLine } from "./SessionChat/StreamLine";

const consultation: Extract<SessionUpdate, { kind: "advisor_consultation" }> = {
  advisor_task_id: "t_adv",
  agent: "codex",
  answer: "Use a **lock file**.",
  cost: { amount: 0.42, currency: "USD" },
  kind: "advisor_consultation",
  model: "gpt-5",
  outcome: "answered",
  question: "How do I stop the race?",
};

describe("advisor consultation in the transcript", () => {
  it("starts collapsed behind a header naming the advisor", () => {
    render(<StreamLine update={consultation} />);

    const header = screen.getByRole("button", { name: /Asked advisor · Codex \/ gpt-5/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("$0.42")).toBeInTheDocument();
    expect(screen.queryByText("How do I stop the race?")).not.toBeInTheDocument();
  });

  it("expands to the question and the answer", async () => {
    render(<StreamLine update={consultation} />);

    await userEvent.click(screen.getByRole("button", { name: /Asked advisor/ }));

    expect(screen.getByText("How do I stop the race?")).toBeInTheDocument();
    expect(screen.getByText("lock file")).toBeInTheDocument();
  });

  it("opens the advisor's conversation", async () => {
    const onOpenTask = vi.fn<(id: string) => void>();
    render(<StreamLine update={consultation} onOpenTask={onOpenTask} />);

    await userEvent.click(screen.getByRole("button", { name: /Asked advisor/ }));
    await userEvent.click(screen.getByRole("button", { name: "Open advisor conversation" }));

    expect(onOpenTask).toHaveBeenCalledWith("t_adv");
  });

  it("marks a failed consultation and shows why", async () => {
    render(
      <StreamLine
        update={{ ...consultation, answer: "The advisor timed out.", outcome: "failed" }}
      />,
    );

    expect(screen.getByRole("region", { name: "Advisor consultation" })).toHaveClass(
      "border-destructive/35",
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Asked advisor/ }));
    expect(screen.getByText("No answer")).toBeInTheDocument();
    expect(screen.getByText("The advisor timed out.")).toBeInTheDocument();
  });
});
