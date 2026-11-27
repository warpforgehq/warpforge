import { Button } from "@/components/ui/button";
import { HAS_NATIVE_GLASS } from "@/lib/platform";
import { THEMES } from "@/lib/themes";
import {
  BLUR_RADIUS_MAX,
  BLUR_RADIUS_MIN,
  SIDEBAR_OPACITY_MAX,
  SIDEBAR_OPACITY_MIN,
  useUi,
} from "@/store/ui";

import {
  hsl,
  NumberInput,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  Slider,
  Toggle,
} from "../primitives";
import { ProjectSections } from "./appearance/ProjectSections";

export default function AppearancePage() {
  const fontSize = useUi((s) => s.fontSize);
  const monoFontSize = useUi((s) => s.monoFontSize);
  const setFontSize = useUi((s) => s.setFontSize);
  const setMonoFontSize = useUi((s) => s.setMonoFontSize);
  const resetFontSizes = useUi((s) => s.resetFontSizes);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const theoMod = useUi((s) => s.theoMod);
  const setTheoMod = useUi((s) => s.setTheoMod);
  const transparentWindow = useUi((s) => s.transparentWindow);
  const setTransparentWindow = useUi((s) => s.setTransparentWindow);
  const sidebarOpacity = useUi((s) => s.sidebarOpacity);
  const setSidebarOpacity = useUi((s) => s.setSidebarOpacity);
  const blurRadius = useUi((s) => s.blurRadius);
  const setBlurRadius = useUi((s) => s.setBlurRadius);
  const bodyGlass = useUi((s) => s.bodyGlass);
  const setBodyGlass = useUi((s) => s.setBodyGlass);

  const fontDirty = fontSize !== 14 || monoFontSize !== 13;
  // Linux has no native window blur, so the glass rows would control nothing.
  const glassOff = !HAS_NATIVE_GLASS || !transparentWindow;
  const opacityPercent = Math.round(sidebarOpacity * 100);

  return (
    <SettingsPage page="appearance">
      <SettingsSection id="theme" title="Theme" padded>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEMES.map((t) => {
            const active = t.id === theme;
            const swatch = (key: keyof typeof t.colors) => hsl(t.colors[key]);
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                aria-pressed={active}
                className={`flex cursor-pointer flex-col items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                  active
                    ? "border-ring bg-foreground/[0.06]"
                    : "border-border bg-background hover:border-edge"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    className="size-4 rounded-full border border-border"
                    style={{ background: swatch("background") }}
                  />
                  <span
                    className="size-4 rounded-full border border-border"
                    style={{ background: swatch("primary") }}
                  />
                  <span
                    className="size-4 rounded-full border border-border"
                    style={{ background: swatch("muted-foreground") }}
                  />
                  <span
                    className="size-4 rounded-full border border-border"
                    style={{ background: swatch("accent") }}
                  />
                </span>
                <span className="text-[0.8125rem] font-medium text-foreground">{t.name}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>
      <SettingsSection
        title="Text"
        actions={
          fontDirty && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 text-[0.75rem] text-muted-foreground"
              onClick={resetFontSizes}
            >
              Restore defaults
            </Button>
          )
        }
      >
        <SettingsRow
          id="ui-font-size"
          title="UI font size"
          description="Labels, chat, buttons — all general chrome."
          hint="Cmd/Ctrl +/− to change, Cmd/Ctrl 0 to reset. Default 14px."
          control={<NumberInput value={fontSize} min={10} max={24} onChange={setFontSize} />}
        />
        <SettingsRow
          id="mono-font-size"
          title="Mono font size"
          description="Code editor, diffs, terminal. Scales on its own."
          hint="Independent of the UI font. Default 13px."
          control={<NumberInput value={monoFontSize} min={9} max={22} onChange={setMonoFontSize} />}
        />
      </SettingsSection>
      <SettingsSection title="Window">
        <SettingsRow
          id="transparent-window"
          title="Transparent window"
          description="Blur the desktop behind the app chrome."
          hint="macOS and Windows only; Linux stays opaque. Takes effect immediately."
          control={
            <Toggle
              id="transparent-window-switch"
              label="Transparent window"
              checked={transparentWindow}
              onChange={setTransparentWindow}
              disabled={!HAS_NATIVE_GLASS}
            />
          }
        />
        <SettingsRow
          id="glass-opacity"
          title="Glass opacity"
          description="How much of the desktop shows through the app."
          hint="The conversation is the most transparent surface; the sidebar and panels sit halfway between it and solid. Default 85%."
          control={
            <Slider
              id="sidebar-opacity"
              value={opacityPercent}
              display={`${opacityPercent}%`}
              min={Math.round(SIDEBAR_OPACITY_MIN * 100)}
              max={Math.round(SIDEBAR_OPACITY_MAX * 100)}
              disabled={glassOff}
              onChange={(percent) => setSidebarOpacity(percent / 100)}
            />
          }
        />
        <SettingsRow
          id="blur-radius"
          title="Blur radius"
          description="Background blur behind the window."
          hint="Higher values cost more to composite. Default 24. macOS only — Windows Acrylic has a fixed radius."
          control={
            <Slider
              id="blur-radius-slider"
              value={blurRadius}
              display={String(blurRadius)}
              min={BLUR_RADIUS_MIN}
              max={BLUR_RADIUS_MAX}
              disabled={glassOff}
              onChange={setBlurRadius}
            />
          }
        />
        <SettingsRow
          id="main-pane-glass"
          title="Main pane glass"
          description="Extend the translucent treatment to the work surface."
          hint="Off keeps diffs, editors and the task pane solid while the chrome stays glass."
          control={
            <Toggle
              id="body-glass"
              label="Main pane glass"
              checked={bodyGlass}
              onChange={setBodyGlass}
              disabled={glassOff}
            />
          }
        />
      </SettingsSection>
      <ProjectSections />
      <SettingsSection title="Privacy">
        <SettingsRow
          id="theomod"
          title="TheoMod"
          description="Blurs email addresses everywhere, for screen sharing."
          hint="Hover a blurred address to peek. Copying still works."
          control={<Toggle id="theo-mod" label="TheoMod" checked={theoMod} onChange={setTheoMod} />}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
