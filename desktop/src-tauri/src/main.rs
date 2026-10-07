#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tauri::Manager;

mod browser;
mod browser_agent;
mod browser_capture;
mod context_menu;
mod daemon;
mod desktop_env;
mod html_render;
#[cfg(target_os = "macos")]
mod macos;
mod notifications;
mod sidecar_log;
mod window;

use daemon::DaemonProcess;
use sidecar_log::SidecarLog;

/// How long the confirmed quit waits for the daemon to finish tearing down
/// (whole service process trees) before killing it.
const DAEMON_EXIT_TIMEOUT: Duration = Duration::from_secs(15);
/// A repeated exit request this soon after the first means the webview is not
/// answering, so take the forced path instead of refusing forever.
const FORCE_EXIT_WINDOW: Duration = Duration::from_secs(5);
/// How long to wait for the webview to acknowledge a quit request before
/// forcing the exit. The UI answers at once when it has the request.
const QUIT_FALLBACK: Duration = Duration::from_secs(10);

/// Set by [`force_exit`] so the exit it asks for is not refused again.
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);
/// Set by the `quit_ui_ready` command: the webview has the quit and is asking
/// the user, so the no-answer fallback stands down.
static UI_ACK: AtomicBool = AtomicBool::new(false);
/// When the last quit was handed to the webview.
static LAST_ASK: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Debug, PartialEq, Eq)]
enum ExitAction {
    /// Leave the event loop.
    Allow,
    /// Refuse and hand the request to the webview.
    Ask,
    /// Refuse and force the quit: the webview is not answering.
    Force,
}

/// What an exit request should do. Pure so the fallback is testable.
fn exit_action(
    now: Instant,
    last_ask: Option<Instant>,
    allow_exit: bool,
    has_window: bool,
) -> ExitAction {
    if allow_exit || !has_window {
        return ExitAction::Allow;
    }
    match last_ask {
        Some(at) if now.duration_since(at) < FORCE_EXIT_WINDOW => ExitAction::Force,
        _ => ExitAction::Ask,
    }
}

/// The forced exit: stop the spawned daemon (bounded) and leave, without
/// waiting on the webview.
fn force_exit(app: &tauri::AppHandle) {
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Some(daemon) = handle.try_state::<DaemonProcess>() {
            daemon.terminate(DAEMON_EXIT_TIMEOUT);
        }
        handle.exit(0);
    });
}

/// The final step of a quit, called by the web UI once it has asked a
/// desktop-owned daemon to stop.
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    force_exit(&app);
}

/// The webview has the quit request and is asking the user; stand the
/// no-answer fallback down.
#[tauri::command]
fn quit_ui_ready() {
    UI_ACK.store(true, Ordering::SeqCst);
}

fn main() {
    env_logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            notifications::init();
            let sidecar_log = match SidecarLog::open() {
                Ok(log) => log,
                Err(error) => {
                    eprintln!("warpforge: could not initialize sidecar log ({error}) — degrading to stderr");
                    SidecarLog::disabled()
                }
            };
            app.manage(daemon::start(app.handle(), &sidecar_log));
            app.manage(html_render::PreviewPages::default());
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol(html_render::SCHEME, html_render::serve)
        .on_menu_event(|app, event| {
            let event_id = event.id().0.as_str();
            if let Some(rest) = event_id.strip_prefix("ctx:") {
                let mut parts = rest.splitn(2, ':');
                if let (Some(request_id), Some(item_id)) = (parts.next(), parts.next()) {
                    let _ = app.emit(
                        "context-menu:clicked",
                        serde_json::json!({
                            "requestId": request_id,
                            "itemId": item_id,
                        }),
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            daemon::endpoint::daemon_endpoint,
            quit_app,
            quit_ui_ready,
            window::set_window_background_blur,
            window::enable_window_glass,
            window::disable_window_glass,
            notifications::notify_attention,
            notifications::withdraw_attention,
            context_menu::show_context_menu,
            browser::browser_open,
            browser::browser_navigate,
            browser::browser_back,
            browser::browser_forward,
            browser::browser_reload,
            browser::browser_stop,
            browser::browser_set_bounds,
            browser::browser_set_visible,
            browser::browser_close,
            browser::browser_close_project,
            browser::browser_pick,
            browser::browser_pick_stop,
            browser::browser_capture_element,
            browser_agent::browser_agent_call,
            browser_agent::browser_agent_screenshot,
            html_render::preview::html_preview
        ])
        .plugin(tauri_plugin_dialog::init())
        .build(tauri::generate_context!())
        .expect("error building warpforge desktop")
        // One quit path for the window's close button, ⌘Q and Dock → Quit:
        // refuse the exit and let the web UI decide. It asks the daemon what is
        // running, asks the user if anything is, and calls `quit_app` to leave.
        // If the UI never answers, the fallback below forces the quit so the
        // app can always be left.
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let has_window = app_handle.get_webview_window("main").is_some();
                let now = Instant::now();
                let last_ask = LAST_ASK.lock().ok().and_then(|at| *at);
                match exit_action(now, last_ask, ALLOW_EXIT.load(Ordering::SeqCst), has_window) {
                    ExitAction::Allow => {}
                    ExitAction::Force => {
                        api.prevent_exit();
                        force_exit(app_handle);
                    }
                    ExitAction::Ask => {
                        api.prevent_exit();
                        UI_ACK.store(false, Ordering::SeqCst);
                        if let Ok(mut at) = LAST_ASK.lock() {
                            *at = Some(now);
                        }
                        let _ = app_handle.emit("app:quit-requested", ());
                        let handle = app_handle.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(QUIT_FALLBACK);
                            if !ALLOW_EXIT.load(Ordering::SeqCst)
                                && !UI_ACK.load(Ordering::SeqCst)
                            {
                                force_exit(&handle);
                            }
                        });
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_is_allowed_once_the_app_may_leave_or_the_window_is_gone() {
        let now = Instant::now();
        assert_eq!(exit_action(now, None, true, true), ExitAction::Allow);
        assert_eq!(exit_action(now, None, false, false), ExitAction::Allow);
    }

    #[test]
    fn the_first_request_is_handed_to_the_ui() {
        assert_eq!(
            exit_action(Instant::now(), None, false, true),
            ExitAction::Ask
        );
    }

    #[test]
    fn a_repeat_request_inside_the_window_forces_the_exit() {
        let now = Instant::now();
        let last = now - Duration::from_secs(1);
        assert_eq!(exit_action(now, Some(last), false, true), ExitAction::Force);
    }

    #[test]
    fn a_repeat_request_after_the_window_asks_again() {
        let now = Instant::now();
        let last = now - FORCE_EXIT_WINDOW - Duration::from_secs(1);
        assert_eq!(exit_action(now, Some(last), false, true), ExitAction::Ask);
    }
}
