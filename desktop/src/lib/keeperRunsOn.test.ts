import { describe, expect, it } from "vitest";

import type { AgentConfig } from "@/protocol";

import { runsOnLabel, runsOnOptions, setKeeperRunsOn } from "./keeperRunsOn";

const opencode: AgentConfig = {
  acpCommand: "opencode acp",
  displayName: "opencode",
  enabled: true,
  id: "opencode",
  models: [
    {
      currentValue: "a",
      id: "model",
      name: "Model",
      options: [{ name: "DeepSeek Flash", value: "opencode-go/deepseek-v4.1-flash" }],
    },
    {
      currentValue: "medium",
      id: "effort",
      name: "Reasoning effort",
      options: [{ name: "High", value: "high" }],
    },
  ],
};

describe("setKeeperRunsOn", () => {
  it("adds the keys after the preset line of a two-line preset file", () => {
    expect(
      setKeeperRunsOn("version: 1\npreset: slop\n", {
        agent: "opencode",
        effort: "high",
        model: "opencode-go/deepseek-v4.1-flash",
      }),
    ).toBe(
      "version: 1\npreset: slop\nagent: opencode\nmodel: opencode-go/deepseek-v4.1-flash\neffort: high\n",
    );
  });

  it("changes existing keys in place and keeps their trailing comments", () => {
    const text = "version: 1\nagent: claude  # cheap\nname: Slop\nmodel: opus\n";
    expect(setKeeperRunsOn(text, { agent: "opencode", model: "flash" })).toBe(
      "version: 1\nagent: opencode  # cheap\nname: Slop\nmodel: flash\n",
    );
  });

  it("removes the keys set back to unset", () => {
    const text = "version: 1\npreset: slop\nagent: opencode\nmodel: x\neffort: high\n";
    expect(setKeeperRunsOn(text, {})).toBe("version: 1\npreset: slop\n");
    expect(setKeeperRunsOn(text, { agent: "opencode", model: "" })).toBe(
      "version: 1\npreset: slop\nagent: opencode\n",
    );
  });

  it("leaves instructions blocks, comments and other keys untouched", () => {
    const text = [
      "# team keeper",
      "version: 1",
      "name: Docs",
      "instructions: |",
      "  agent: not a key",
      "  model: nor this",
      "",
      "  Check the docs.",
      "max_rounds: 2",
      "",
    ].join("\n");
    expect(setKeeperRunsOn(text, { agent: "claude", model: "opus[1m]" })).toBe(
      [
        "# team keeper",
        "version: 1",
        "agent: claude",
        'model: "opus[1m]"',
        "name: Docs",
        "instructions: |",
        "  agent: not a key",
        "  model: nor this",
        "",
        "  Check the docs.",
        "max_rounds: 2",
        "",
      ].join("\n"),
    );
  });
});

describe("runsOnLabel", () => {
  it("names the task's agent when the file names no harness", () => {
    expect(runsOnLabel({}, [opencode])).toBe("Task's agent");
  });

  it("shows the harness and the model's name, or the model id's last segment", () => {
    const model = "opencode-go/deepseek-v4.1-flash";
    expect(runsOnLabel({ agent: "opencode", model }, [opencode])).toBe("opencode · DeepSeek Flash");
    expect(runsOnLabel({ agent: "opencode", model }, [])).toBe("opencode · deepseek-v4.1-flash");
  });
});

describe("runsOnOptions", () => {
  it("splits a harness's selectors into model and effort", () => {
    const options = runsOnOptions([opencode], "opencode");
    expect(options.model?.id).toBe("model");
    expect(options.effort?.id).toBe("effort");
    expect(runsOnOptions([opencode], undefined)).toEqual({ effort: undefined, model: undefined });
  });
});
