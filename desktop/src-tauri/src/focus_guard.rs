//! A page script focusing an element makes WebKit turn that tab's webview into
//! the window's first responder, even while the tab is hidden, so the user's
//! typing would land in the agent's page; agent calls hand focus back.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tauri::Webview;

/// The window's first responder from before an agent call, held as a retained
/// raw pointer (0 when there is nothing to restore) so the guard can cross
/// an await; only the main thread turns it back into an object.
pub(crate) struct FocusGuard(Arc<AtomicUsize>);

/// Remember the window's first responder unless it already sits in `agent`.
/// @param agent the tab's webview the call runs in
/// @returns a guard to hand to `restore` once the call is done
pub(crate) fn hold(agent: &Webview) -> FocusGuard {
    let slot = Arc::new(AtomicUsize::new(0));
    hold_on_main(agent, &slot);
    FocusGuard(slot)
}

impl FocusGuard {
    /// Give focus back to the remembered responder if the call moved it into `agent`.
    /// @param agent the tab's webview the call ran in
    pub(crate) fn restore(self, agent: &Webview) {
        restore_on_main(agent, &self.0);
    }
}

#[cfg(target_os = "macos")]
fn hold_on_main(agent: &Webview, slot: &Arc<AtomicUsize>) {
    let slot = Arc::clone(slot);
    let _ = agent.with_webview(move |platform| {
        let (window, view) = unsafe { macos::parts(&platform) };
        let Some(responder) = window.firstResponder() else {
            return;
        };
        if macos::inside(&responder, view) {
            return;
        }
        slot.store(
            objc2::rc::Retained::into_raw(responder) as usize,
            Ordering::Release,
        );
    });
}

#[cfg(not(target_os = "macos"))]
fn hold_on_main(agent: &Webview, _slot: &Arc<AtomicUsize>) {
    let _ = agent;
}

#[cfg(target_os = "macos")]
fn restore_on_main(agent: &Webview, slot: &Arc<AtomicUsize>) {
    let slot = Arc::clone(slot);
    let _ = agent.with_webview(move |platform| {
        let held = slot.swap(0, Ordering::Acquire) as *mut objc2_app_kit::NSResponder;
        let Some(previous) = (unsafe { objc2::rc::Retained::from_raw(held) }) else {
            return;
        };
        let (window, view) = unsafe { macos::parts(&platform) };
        let moved = window
            .firstResponder()
            .is_some_and(|now| macos::inside(&now, view));
        if moved && macos::still_in(&previous, window) {
            let _ = window.makeFirstResponder(Some(&previous));
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn restore_on_main(agent: &Webview, _slot: &Arc<AtomicUsize>) {
    let _ = agent;
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2_app_kit::{NSResponder, NSView, NSWindow};
    use tauri::webview::PlatformWebview;

    /// The webview's window and its own view.
    ///
    /// # Safety
    /// Call on the main thread, inside `Webview::with_webview`.
    pub(super) unsafe fn parts(platform: &PlatformWebview) -> (&NSWindow, &NSView) {
        (
            &*(platform.ns_window() as *const NSWindow),
            &*(platform.inner() as *const NSView),
        )
    }

    pub(super) fn inside(responder: &NSResponder, view: &NSView) -> bool {
        responder
            .downcast_ref::<NSView>()
            .is_some_and(|v| v.isDescendantOf(view))
    }

    /// A view that left the window since must not get focus back.
    pub(super) fn still_in(responder: &NSResponder, window: &NSWindow) -> bool {
        match responder.downcast_ref::<NSView>() {
            Some(view) => view.window().is_some_and(|w| std::ptr::eq(&*w, window)),
            None => true,
        }
    }
}
