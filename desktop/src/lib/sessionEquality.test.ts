import { describe, expect, it } from "vitest";

import type { SessionUpdate } from "../protocol";
import { sessionUpdatesSemanticallyEqual } from "./sessionEquality";

const consultation: Extract<SessionUpdate, { kind: "advisor_consultation" }> = {
  advisor_task_id: "t_adv",
  agent: "codex",
  answer: "Use a lock file.",
  kind: "advisor_consultation",
  outcome: "answered",
  question: "How do I stop the race?",
};

describe("sessionUpdatesSemanticallyEqual for advisor consultations", () => {
  it("treats a copy with the same content as equal", () => {
    expect(sessionUpdatesSemanticallyEqual(consultation, { ...consultation })).toBe(true);
  });

  it.each([
    ["question", { question: "Why?" }],
    ["answer", { answer: "Retry." }],
    ["outcome", { outcome: "failed" as const }],
    ["advisor task", { advisor_task_id: "t_other" }],
  ])("tells a different %s apart", (_, change) => {
    expect(sessionUpdatesSemanticallyEqual(consultation, { ...consultation, ...change })).toBe(
      false,
    );
  });
});

describe("sessionUpdatesSemanticallyEqual for html renders", () => {
  const page: SessionUpdate = {
    kind: "html_render",
    render_id: "r_1",
    title: "Chart",
    height: 400,
  };

  it("treats a copy as equal and a different page or size as different", () => {
    expect(sessionUpdatesSemanticallyEqual(page, { ...page })).toBe(true);
    expect(sessionUpdatesSemanticallyEqual(page, { ...page, render_id: "r_2" })).toBe(false);
    expect(sessionUpdatesSemanticallyEqual(page, { ...page, title: "Other" })).toBe(false);
    expect(sessionUpdatesSemanticallyEqual(page, { ...page, height: 500 })).toBe(false);
  });
});

describe("sessionUpdatesSemanticallyEqual for peer messages", () => {
  const message: SessionUpdate = {
    direction: "received",
    from_label: "Backend",
    from_task: "t_b",
    kind: "peer_message",
    message_ids: [1, 2],
    text: "API is ready",
  };

  it("treats a copy as equal and any changed field as different", () => {
    expect(sessionUpdatesSemanticallyEqual(message, { ...message, message_ids: [1, 2] })).toBe(
      true,
    );
    expect(sessionUpdatesSemanticallyEqual(message, { ...message, text: "Not yet" })).toBe(false);
    expect(sessionUpdatesSemanticallyEqual(message, { ...message, direction: "digest" })).toBe(
      false,
    );
    expect(sessionUpdatesSemanticallyEqual(message, { ...message, from_task: "t_c" })).toBe(false);
    expect(sessionUpdatesSemanticallyEqual(message, { ...message, message_ids: [1, 3] })).toBe(
      false,
    );
  });
});
