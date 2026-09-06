//! macOS window glass: WindowServer background blur behind a transparent
//! NSWindow. CSS only tints the surfaces on top of it.
//!
//! The blur comes from `CGSSetWindowBackgroundBlurRadius`, a private
//! WindowServer symbol resolved at runtime — `NSVisualEffectView` (what
//! window-vibrancy installs) has a fixed material and no radius knob.
//!
//! A fully clear `NSColor.clearColor` (alpha 0) plus a native shadow makes
//! macOS draw a chamfered gap at the window corners. A tiny alpha (0.01)
//! keeps the shadow without that outline.

use std::ffi::{c_char, c_int, c_void};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::OnceLock;

use objc2::rc::Retained;
use objc2_app_kit::{NSColor, NSView, NSWindow};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::WebviewWindow;

pub const BLUR_MIN: u8 = 1;
pub const BLUR_MAX: u8 = 64;
pub const BLUR_DEFAULT: u8 = 24;

/// Same colour as `backgroundColor` in tauri.conf.json, so turning glass off
/// lands on the boot field rather than a flash of another shade.
const OPAQUE_RGB: (f64, f64, f64) = (23.0 / 255.0, 23.0 / 255.0, 23.0 / 255.0);

const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

static BLUR_RADIUS: AtomicU8 = AtomicU8::new(BLUR_DEFAULT);

type CgsConnection = usize;
type SetBlurFn = unsafe extern "C" fn(CgsConnection, c_int, c_int) -> c_int;
type ConnectionFn = unsafe extern "C" fn() -> CgsConnection;

extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

pub fn set_background_blur_radius(window: &WebviewWindow, radius: u8) {
    let radius = radius.clamp(BLUR_MIN, BLUR_MAX);
    BLUR_RADIUS.store(radius, Ordering::Relaxed);
    apply_blur(window, radius);
}

/// Turn on desktop blur, deferred to after the first UI paint so the dock
/// bounce and the connecting screen are a solid field, not a frosted desktop.
pub fn enable_glass(window: &WebviewWindow) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor().colorWithAlphaComponent(0.01)));
    ns_window.setHasShadow(true);
    ns_window.invalidateShadow();
    apply_blur(window, BLUR_RADIUS.load(Ordering::Relaxed));
}

pub fn disable_glass(window: &WebviewWindow) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    // Radius 0 is how the blur is removed — the private API has no "off".
    apply_blur(window, 0);
    ns_window.setOpaque(true);
    ns_window.setBackgroundColor(Some(&NSColor::colorWithRed_green_blue_alpha(
        OPAQUE_RGB.0,
        OPAQUE_RGB.1,
        OPAQUE_RGB.2,
        1.0,
    )));
    ns_window.invalidateShadow();
}

fn apply_blur(window: &WebviewWindow, radius: u8) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    let Some(set_blur) = set_blur_fn() else {
        return;
    };
    let Some(connection) = cgs_connection() else {
        return;
    };
    let window_number = ns_window.windowNumber();
    if window_number <= 0 {
        return;
    }
    unsafe {
        set_blur(connection, window_number as c_int, radius as c_int);
    }
}

fn ns_window(window: &WebviewWindow) -> Option<Retained<NSWindow>> {
    let Ok(handle) = window.window_handle() else {
        return None;
    };
    let RawWindowHandle::AppKit(appkit) = handle.as_raw() else {
        return None;
    };
    let ns_view: *mut NSView = appkit.ns_view.as_ptr().cast();
    if ns_view.is_null() {
        return None;
    }
    unsafe { &*ns_view }.window()
}

fn set_blur_fn() -> Option<SetBlurFn> {
    static FN: OnceLock<Option<SetBlurFn>> = OnceLock::new();
    *FN.get_or_init(|| dlsym_fn(b"CGSSetWindowBackgroundBlurRadius\0"))
}

fn cgs_connection() -> Option<CgsConnection> {
    static FN: OnceLock<Option<ConnectionFn>> = OnceLock::new();
    let function = (*FN.get_or_init(|| {
        dlsym_fn(b"CGSDefaultConnectionForThread\0").or_else(|| dlsym_fn(b"CGSMainConnectionID\0"))
    }))?;
    let connection = unsafe { function() };
    (connection != 0).then_some(connection)
}

fn dlsym_fn<T>(symbol: &[u8]) -> Option<T> {
    unsafe {
        let ptr = dlsym(RTLD_DEFAULT, symbol.as_ptr().cast());
        if ptr.is_null() {
            None
        } else {
            Some(std::mem::transmute_copy(&ptr))
        }
    }
}
