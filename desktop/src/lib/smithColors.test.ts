import { describe, expect, it } from "vitest";

import { defaultSmithColor, smithColor, smithColorIndex } from "./smithColors";
import { CHART_COLORS, THEMES } from "./themes";

describe("Smith colours", () => {
  it("map a palette index to a theme token, never a fixed colour", () => {
    expect(smithColor(0)).toBe("hsl(var(--chart-1))");
    expect(smithColor(5, 0.2)).toBe("hsl(var(--chart-6) / 0.2)");
    expect(smithColor(7)).toBe("hsl(var(--chart-2))");
  });

  it("use the stored index, else a stable one for the id", () => {
    expect(smithColorIndex({ color: 3, id: "sm_1" })).toBe(3);
    expect(smithColorIndex({ color: 99, id: "sm_1" })).toBe(defaultSmithColor("sm_1"));
    expect(smithColorIndex({ id: "sm_2" })).toBe(defaultSmithColor("sm_2"));
  });

  it("derive the same default as the daemon", () => {
    // src/daemon/smiths/mod.rs `default_color`, for the same ids.
    expect(["sm_1", "sm_abcd1234", "sm_ff00"].map(defaultSmithColor)).toStrictEqual(
      ["sm_1", "sm_abcd1234", "sm_ff00"].map((id) => {
        let hash = 0;
        for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
        return hash % 6;
      }),
    );
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
