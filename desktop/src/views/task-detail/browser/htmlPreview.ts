import { htmlRenderTheme, htmlRenderThemeFragment, themeForAppearance } from "@/lib/htmlRender";
import { getTheme } from "@/lib/themes";
import type { ClientRequestBody } from "@/protocol";
import { useUi } from "@/store/ui";

import { browser } from "./browserClient";

/**
 * Screenshot an agent's HTML page in the theme the chat would show it in.
 * @param body the daemon's request
 * @returns the capture, its heights and console problems, and the appearance used
 */
export async function runHtmlPreview(
  body: Extract<ClientRequestBody, { kind: "html_preview" }>,
): Promise<Record<string, unknown>> {
  const current = useUi.getState().theme;
  const appearance = body.appearance ?? getTheme(current).mode;
  const theme = htmlRenderTheme(themeForAppearance(current, appearance));
  const result = await browser.htmlPreview(body.html, body.width, htmlRenderThemeFragment(theme));
  return { ...result, appearance };
}
