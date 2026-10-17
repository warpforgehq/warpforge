import { describe, expect, it } from "vitest";

import type { Channel } from "@/protocol";

import { channelKey, channelNameError, channelUnread, projectChannels } from "./teamChannels";

const channel = (id: string, name: string, project = "demo"): Channel => ({
  createdAt: 1,
  id,
  members: [],
  name,
  project,
});

describe("projectChannels", () => {
  it("is #general alone without named channels", () => {
    expect(projectChannels("demo")).toStrictEqual([
      { id: "general", key: "demo::team", name: "general", project: "demo" },
    ]);
  });

  it("keeps #general first and lists the project's named channels by name", () => {
    const channels = projectChannels("demo", [
      channel("c2", "releases"),
      channel("c1", "ci"),
      channel("c3", "ops", "other"),
    ]);
    expect(channels.map((c) => c.name)).toStrictEqual(["general", "ci", "releases"]);
    expect(channels[1]!.key).toBe(channelKey("demo", "c1"));
  });
});

describe("channelNameError", () => {
  it.each(["ci", "release-2", "a_b"])("accepts %s", (name) => {
    expect(channelNameError(name)).toBeNull();
  });

  it.each([
    ["", "needs a name"],
    ["CI", "lowercase"],
    ["two words", "lowercase"],
    ["general", "already exists"],
    ["ci", "already exists"],
    ["a".repeat(33), "32 characters"],
  ])("refuses %j", (name, message) => {
    expect(channelNameError(name, ["ci"])).toContain(message);
  });
});

describe("channelUnread", () => {
  it("counts others' posts in that channel since it was open", () => {
    const post = (id: number, createdAt: number, extra: object = {}) => ({
      createdAt,
      fromTask: "t_a",
      id,
      project: "demo",
      status: "posted" as const,
      text: "",
      ...extra,
    });
    const records = [
      post(1, 50, { channelId: "c1" }),
      post(2, 150, { channelId: "c1" }),
      post(3, 160, { channelId: "c1", fromTask: undefined }),
      post(4, 170),
      post(5, 180, { channelId: "c1", toTask: "t_b" }),
    ];
    expect(channelUnread(records, channelKey("demo", "c1"), 100)).toBe(1);
    expect(channelUnread(records, channelKey("demo"), 100)).toBe(1);
  });
});
