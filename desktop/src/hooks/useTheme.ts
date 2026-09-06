import { useEffect } from "react";

import { HAS_NATIVE_GLASS, IS_TAURI } from "@/lib/platform";
import { getTheme } from "@/lib/themes";
import { useUi } from "@/store/ui";
/** Current theme's light/dark mode, for consumers that branch on it (CodeMirror). */
export function useThemeMode(): "light" | "dark" {
  const themeId = useUi((s) => s.theme);
  return getTheme(themeId).mode;
}

/**
 * Applies the selected color theme to the document root — the mirror image of
 * useFontScaling. Each theme's palette is written as CSS variables on the root
 * element, which every styled surface reads via hsl(var(--...)). The `dark`
 * class (which tailwind is configured to key off) follows the theme's mode so
 * any `dark:` variants + OS chrome stay consistent with the palette.
 */
export function useTheme() {
  const themeId = useUi((s) => s.theme);
  const theme = getTheme(themeId);
  const transparentWindow = useUi((s) => s.transparentWindow);
  const sidebarOpacity = useUi((s) => s.sidebarOpacity);
  const blurRadius = useUi((s) => s.blurRadius);
  const bodyGlass = useUi((s) => s.bodyGlass);

  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(theme.colors)) {
      root.style.setProperty(`--${name}`, value);
    }
    root.dataset.theme = theme.id;
    root.classList.toggle("dark", theme.mode === "dark");
  }, [theme]);

  useEffect(() => {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute("content", theme.mode === "dark" ? "dark" : "light");
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-opacity", String(sidebarOpacity));
  }, [sidebarOpacity]);

  useEffect(() => {
    document.documentElement.classList.toggle("glass-body", bodyGlass);
  }, [bodyGlass]);

  useEffect(() => {
    // Glass only under Tauri on a platform with native blur. In the web
    // fallback and on Linux keep the opaque theme — a translucent body over a
    // white browser canvas reads whitish.
    const glass = IS_TAURI && HAS_NATIVE_GLASS && transparentWindow;
    document.documentElement.classList.toggle("native-glass", glass);
    if (!IS_TAURI) return;
    void import("@tauri-apps/api/core")
      .then(async ({ invoke }) => {
        if (!glass) {
          await invoke("disable_window_glass");
          return;
        }
        // Radius first: enabling glass re-applies the stored radius, so this
        // order never shows the default 24 before the user's value.
        await invoke("set_window_background_blur", { radius: blurRadius });
        await invoke("enable_window_glass");
      })
      // Swallowing this silently is how a failed blur call reads as "the
      // toggle does nothing" with no way to tell why.
      .catch((error) => console.error("window glass failed", error));
  }, [transparentWindow, blurRadius]);
}
