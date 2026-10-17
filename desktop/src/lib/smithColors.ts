import type { Smith } from "../protocol";
import { CHART_COLORS } from "./themes";

/**
 * A Smith's colour when the daemon sent none (an older daemon): stable for its
 * id, and the same rule the daemon uses for rows without a colour.
 * @param id the Smith's id
 * @returns a palette index
 */
export function defaultSmithColor(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % CHART_COLORS;
}

/**
 * @param smith the Smith's id and stored colour
 * @returns its palette index, kept in range
 */
export function smithColorIndex(smith: Pick<Smith, "id" | "color">): number {
  const index = smith.color;
  return index !== undefined && Number.isInteger(index) && index >= 0 && index < CHART_COLORS
    ? index
    : defaultSmithColor(smith.id);
}

/**
 * @param index a palette index
 * @returns the theme token for it, as a CSS colour; `alpha` makes a tint
 */
export function smithColor(index: number, alpha?: number): string {
  const token = `var(--chart-${(index % CHART_COLORS) + 1})`;
  return alpha === undefined ? `hsl(${token})` : `hsl(${token} / ${alpha})`;
}
