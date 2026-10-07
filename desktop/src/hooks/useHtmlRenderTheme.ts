import { useMemo } from "react";

import { htmlRenderTheme, type HtmlRenderTheme } from "@/lib/htmlRender";
import { getTheme } from "@/lib/themes";
import { useUi } from "@/store/ui";

/** The app's current theme as an HTML render receives it. */
export function useHtmlRenderTheme(): HtmlRenderTheme {
  const id = useUi((s) => s.theme);
  return useMemo(() => htmlRenderTheme(getTheme(id)), [id]);
}
