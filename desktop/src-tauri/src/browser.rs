//! In-app browser: native child webviews driven by a React chrome.
//!
//! A real page cannot live in an `<iframe>` — sites send `X-Frame-Options` and
//! refuse to render — so each tab is a native webview added as a child of the
//! main window. The tab strip, URL bar and buttons are React; this module only
//! creates, positions, navigates and reports the content views.
//!
//! The webview covers the React content within its rectangle, so the chrome
//! stays above it and the view is hidden whenever the browser surface is not the
//! one on screen. Bounds are synced to a placeholder the React side measures.

use serde::Serialize;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl};

const HOST_WINDOW: &str = "main";
const STATE_EVENT: &str = "browser:state";

/// Every child webview is labelled `browser:<tabId>`, so one namespace of
/// labels belongs to the browser and nothing else collides with it.
fn label_for(tab_id: &str) -> String {
    format!("browser:{tab_id}")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserState {
    tab_id: String,
    url: String,
    loading: bool,
}

fn emit_state(app: &AppHandle, tab_id: &str, url: &str, loading: bool) {
    let _ = app.emit(
        STATE_EVENT,
        BrowserState {
            tab_id: tab_id.to_string(),
            url: url.to_string(),
            loading,
        },
    );
}

fn parse_url(url: &str) -> Result<tauri::Url, String> {
    url.parse().map_err(|_| format!("invalid URL: {url}"))
}

/// Create the tab's webview if it does not exist yet, then position and show it.
/// A second call for the same tab just navigates and repositions.
#[tauri::command]
pub fn browser_open(
    app: AppHandle,
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let target = parse_url(&url)?;
    let label = label_for(&tab_id);

    if let Some(webview) = app.get_webview(&label) {
        webview.navigate(target).map_err(|e| e.to_string())?;
        set_bounds(&app, &tab_id, x, y, width, height)?;
        webview.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = app
        .get_window(HOST_WINDOW)
        .ok_or_else(|| "main window is not available".to_string())?;

    let tab_for_load = tab_id.clone();
    let app_for_load = app.clone();
    // The default (non-incognito) data store is persistent per app, so a login
    // survives restarts without any special store handling.
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(target)).on_page_load(
        move |webview, payload| {
            let loading = matches!(payload.event(), PageLoadEvent::Started);
            emit_state(
                &app_for_load,
                &tab_for_load,
                payload.url().as_str(),
                loading,
            );
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let app = app_for_load.clone();
                let tab = tab_for_load.clone();
                let url = payload.url().to_string();
                // Title is not on the payload; read it once the page settled.
                // The callback hands back the eval result JSON-encoded, so a
                // title is a quoted, escaped string — decode it to plain text.
                let _ = webview.eval_with_callback("document.title", move |raw| {
                    let title = serde_json::from_str::<String>(&raw).unwrap_or(raw);
                    let _ = app.emit(
                        "browser:title",
                        serde_json::json!({ "tabId": tab, "url": url, "title": title }),
                    );
                });
            }
        },
    );

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, tab_id: String, url: String) -> Result<(), String> {
    let target = parse_url(&url)?;
    let webview = app
        .get_webview(&label_for(&tab_id))
        .ok_or_else(|| "no such browser tab".to_string())?;
    webview.navigate(target).map_err(|e| e.to_string())
}

/// Back and forward go through the page's own history rather than a Tauri call,
/// because the runtime exposes no history API on a child webview.
#[tauri::command]
pub fn browser_back(app: AppHandle, tab_id: String) -> Result<(), String> {
    eval(&app, &tab_id, "history.back()")
}

#[tauri::command]
pub fn browser_forward(app: AppHandle, tab_id: String) -> Result<(), String> {
    eval(&app, &tab_id, "history.forward()")
}

#[tauri::command]
pub fn browser_reload(app: AppHandle, tab_id: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label_for(&tab_id))
        .ok_or_else(|| "no such browser tab".to_string())?;
    webview.reload().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn browser_stop(app: AppHandle, tab_id: String) -> Result<(), String> {
    eval(&app, &tab_id, "window.stop()")
}

#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    tab_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    set_bounds(&app, &tab_id, x, y, width, height)
}

#[tauri::command]
pub fn browser_set_visible(app: AppHandle, tab_id: String, visible: bool) -> Result<(), String> {
    let webview = app
        .get_webview(&label_for(&tab_id))
        .ok_or_else(|| "no such browser tab".to_string())?;
    if visible {
        webview.show().map_err(|e| e.to_string())
    } else {
        webview.hide().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn browser_close(app: AppHandle, tab_id: String) -> Result<(), String> {
    if let Some(webview) = app.get_webview(&label_for(&tab_id)) {
        webview.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Close every tab belonging to a project, called when the project is removed so
/// its native views do not outlive it. Tab ids are `<project>:<uuid>`, so the
/// project's views all share the `browser:<project>:` label prefix.
#[tauri::command]
pub fn browser_close_project(app: AppHandle, project: String) -> Result<(), String> {
    let Some(window) = app.get_window(HOST_WINDOW) else {
        return Ok(());
    };
    let prefix = format!("browser:{project}:");
    for webview in window.webviews() {
        if webview.label().starts_with(&prefix) {
            let _ = webview.close();
        }
    }
    Ok(())
}

fn set_bounds(
    app: &AppHandle,
    tab_id: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let webview = app
        .get_webview(&label_for(tab_id))
        .ok_or_else(|| "no such browser tab".to_string())?;
    webview
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    webview
        .set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())
}

fn eval(app: &AppHandle, tab_id: &str, js: &str) -> Result<(), String> {
    let webview = app
        .get_webview(&label_for(tab_id))
        .ok_or_else(|| "no such browser tab".to_string())?;
    webview.eval(js).map_err(|e| e.to_string())
}
