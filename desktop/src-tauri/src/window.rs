//! Window glass commands. macOS blurs the desktop with an adjustable radius
//! (see `macos`); Windows uses DWM Acrylic, which has no radius knob; Linux
//! stays opaque.

#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::window::Color;
#[cfg(target_os = "windows")]
use tauri::window::{Effect, EffectsBuilder};
use tauri::WebviewWindow;

/// Background blur radius, clamped to 1–64 (default 24) by the platform code.
#[tauri::command]
pub fn set_window_background_blur(
    #[allow(unused_variables)] window: WebviewWindow,
    #[allow(unused_variables)] radius: u8,
) {
    #[cfg(target_os = "macos")]
    crate::macos::set_background_blur_radius(&window, radius);
}

/// Called from the frontend once the first UI frame is on screen: until then
/// the window is the opaque boot colour, so the launch never shows a frosted
/// desktop with no app on top of it.
#[tauri::command]
pub fn enable_window_glass(#[allow(unused_variables)] window: WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        // Webview clear colour: 0 alpha leaves a chamfered corner gap next to
        // the native shadow, so keep a hair of opacity.
        let _ = window.set_background_color(Some(Color(0, 0, 0, 3)));
        crate::macos::enable_glass(&window);
    }
    #[cfg(target_os = "windows")]
    {
        let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
        let _ = window.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build());
    }
}

#[tauri::command]
pub fn disable_window_glass(#[allow(unused_variables)] window: WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        crate::macos::disable_glass(&window);
        let _ = window.set_background_color(Some(Color(23, 23, 23, 255)));
    }
    #[cfg(target_os = "windows")]
    {
        let _ = window.set_effects(EffectsBuilder::new().build());
        let _ = window.set_background_color(Some(Color(23, 23, 23, 255)));
    }
}
