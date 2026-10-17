import { describe, expect, it } from "vitest";

import { defaultSmithColor, smithColor, smithColorIndex } from "./smithColors";
import { CHART_COLORS, THEMES } from "./themes";

describe("Smith colours", () => {
  it("map a palette index to a theme token, never a fixed colour", () => {
    expect(smithColor(0)).toBe("hsl(var(--chart-1))");
    expect(smithColor(5, 0.2)).toBe("hsl(var(--chart-6) / 0.2)");
    expect(smithColor(7)).toBe("hsl(var(--chart-2))");
  });

  it("use the picked index, else a stable one for the id", () => {
    expect(smithColorIndex("sm_1", { sm_1: 3 })).toBe(3);
    expect(smithColorIndex("sm_1", { sm_1: 99 })).toBe(defaultSmithColor("sm_1"));
    expect(smithColorIndex("sm_2", {})).toBe(defaultSmithColor("sm_2"));
    expect(defaultSmithColor("sm_2")).toBe(defaultSmithColor("sm_2"));
  });

  it.each(THEMES.map((theme) => [theme.id, theme] as const))(
    "%s defines every palette colour with distinct hues",
    (_id, theme) => {
      const colors = theme.colors as unknown as Record<string, string>;
      const hues = Array.from({ length: CHART_COLORS }, (_, i) => {
        const value = colors[`chart-${i + 1}`];
        expect(value).toMatch(/^\d+ \d+% \d+%$/);
        return Number(value!.split(" ")[0]);
      });
      expect(new Set(hues).size).toBe(CHART_COLORS);
    },
  );
});
