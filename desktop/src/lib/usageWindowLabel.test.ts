import { describe, expect, it } from "vitest";

import type { AgentLimitWindow } from "../protocol";
import { usageWindowShortLabel } from "./usageWindowLabel";

const window = (id: string, label: string, windowMinutes?: number): AgentLimitWindow => ({
  id,
  label,
  usedPercent: 10,
  windowMinutes,
});

describe("usageWindowShortLabel", () => {
  it("names a session window by its length, 5h when the length is unknown", () => {
    expect(usageWindowShortLabel(window("five_hour", "Session", 300))).toBe("5h");
    expect(usageWindowShortLabel(window("primary", "Session"))).toBe("5h");
    expect(usageWindowShortLabel(window("rolling", "Session", 240))).toBe("4h");
  });

  it("falls back to minutes for a session that is not a whole number of hours", () => {
    expect(usageWindowShortLabel(window("rolling", "Session", 90))).toBe("90m");
  });

  it("matches the session by id even when the label differs", () => {
    expect(usageWindowShortLabel(window("five_hour", "5-hour"))).toBe("5h");
  });

  it("names the weekly window wk, by label or by id", () => {
    expect(usageWindowShortLabel(window("secondary", "Weekly", 10080))).toBe("wk");
    expect(usageWindowShortLabel(window("seven_day", "7-day"))).toBe("wk");
  });

  it("shortens other windows while keeping their qualifier", () => {
    expect(usageWindowShortLabel(window("seven_day_opus", "Weekly (Opus)"))).toBe("wk Opus");
    expect(usageWindowShortLabel(window("monthly", "Monthly"))).toBe("mo");
  });

  it("returns an unrecognised label unchanged", () => {
    expect(usageWindowShortLabel(window("rate_limited", "Rate limited"))).toBe("Rate limited");
  });
});
