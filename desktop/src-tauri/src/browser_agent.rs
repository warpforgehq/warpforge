//! The daemon's browser tools, run in a tab: outline, click, type and console
//! through `browser_agent.js`, and screenshots. Both the native view's URL and
//! the document the script runs in must be on an origin the daemon allowed;
//! either one failing answers `{ blocked }`, never the action.

use std::sync::{mpsc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Url, Webview};

/// Injected before page scripts, ahead of `AGENT_SCRIPT`: keeps the page's
/// console messages from the start of the load.
pub(crate) const CONSOLE_SCRIPT: &str = include_str!("browser_console.js");

/// Injected before page scripts; answers `__wfAgent(call)`.
pub(crate) const AGENT_SCRIPT: &str = include_str!("browser_agent.js");

const PAGE_TIMEOUT: Duration = Duration::from_secs(10);

/// The tool's error when the tab has no native view, which the web side reads
/// to decide whether to open one.
const NO_TAB: &str = "no such browser tab";

fn webview_for(app: &AppHandle, tab_id: &str) -> Result<Webview, String> {
    app.get_webview(&crate::browser::label_for(tab_id))
        .ok_or_else(|| NO_TAB.to_string())
}

/// The native view's URL when its origin is allowed, else the `blocked` answer
/// the daemon asks the user about. The native URL moves to a new address as
/// soon as a load starts, so this alone does not say which document a script
/// runs in; the script checks that document itself.
fn gate(webview: &Webview, allowed: &[String]) -> Result<Result<Url, Value>, String> {
    let url = webview.url().map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(format!(
            "no web page is open in the browser tab (it shows {url}); open one with browser_navigate"
        ));
    }
    let origin = url.origin().ascii_serialization();
    if allowed.contains(&origin) {
        Ok(Ok(url))
    } else {
        Ok(Err(json!({ "blocked": origin, "url": url.as_str() })))
    }
}

async fn wait<T: Send + 'static>(rx: mpsc::Receiver<T>) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(PAGE_TIMEOUT))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "the page did not answer within 10s; it may be busy or still loading".into())
}

/// Evaluate one `__wfAgent` call in the document the tab shows now.
async fn run_script(webview: &Webview, call: &Value) -> Result<Value, String> {
    let js = format!(
        "(function(){{var a=window.__wfAgent;return typeof a==='function'?a({call}):null;}})()"
    );
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(Some(tx));
    webview
        .eval_with_callback(js, move |raw| {
            if let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) {
                let _ = tx.send(raw);
            }
        })
        .map_err(|e| e.to_string())?;
    let raw = wait(rx).await?;
    // The callback hands back the script's string result JSON-encoded; an
    // empty or non-string result means the script is not in this page.
    let text: String = serde_json::from_str(&raw).map_err(|_| {
        "the page did not run the browser script; reload it and try again".to_string()
    })?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|e| format!("the browser script returned invalid JSON: {e}"))?;
    match value.get("error").and_then(Value::as_str) {
        Some(error) => Err(error.to_string()),
        None => Ok(value),
    }
}

/// A script result the daemon can act on: refused unless it names the
/// document's origin and that origin is allowed.
fn checked(mut value: Value, allowed: &[String], tab_id: &str, native: &Url) -> Value {
    let origin = value
        .get("origin")
        .and_then(Value::as_str)
        .map(str::to_string);
    let refused = value.get("blocked").is_some();
    match origin {
        Some(origin) if refused || allowed.contains(&origin) => {}
        Some(origin) => value = json!({ "blocked": origin, "url": value.get("url") }),
        None => value = json!({ "blocked": "unknown", "url": native.as_str() }),
    }
    if let Some(object) = value.as_object_mut() {
        object.insert("tab".into(), json!(tab_id));
        object.insert("nativeUrl".into(), json!(native.as_str()));
    }
    value
}

/// Run one `browser_agent.js` call in the tab. `origin` only reports where the
/// document is and runs anywhere; every other call must pass both checks.
/// @param tab_id the tab
/// @param call the call, e.g. `{ "action": "click", "ref": "e3" }`
/// @param allowed_origins origins the page may be on
/// @returns the script's result with `tab` and `nativeUrl`, or `{ blocked }`
#[tauri::command]
pub async fn browser_agent_call(
    app: AppHandle,
    tab_id: String,
    mut call: Value,
    allowed_origins: Vec<String>,
) -> Result<Value, String> {
    let webview = webview_for(&app, &tab_id)?;
    let reporting = call.get("action").and_then(Value::as_str) == Some("origin");
    let native = if reporting {
        webview.url().map_err(|e| e.to_string())?
    } else {
        match gate(&webview, &allowed_origins)? {
            Ok(url) => url,
            Err(blocked) => return Ok(blocked),
        }
    };
    if let Some(object) = call.as_object_mut() {
        object.insert("allowed".into(), json!(allowed_origins));
    }
    let focus = crate::focus_guard::hold(&webview);
    let value = run_script(&webview, &call).await;
    focus.restore(&webview);
    let value = value?;
    if reporting {
        let mut value = value;
        if let Some(object) = value.as_object_mut() {
            object.insert("tab".into(), json!(tab_id));
            object.insert("nativeUrl".into(), json!(native.as_str()));
        }
        return Ok(value);
    }
    Ok(checked(value, &allowed_origins, &tab_id, &native))
}

/// Screenshot what the tab shows, between two checks that the document is on
/// an allowed origin; a page that moved in between is refused.
/// @param tab_id the tab
/// @param allowed_origins origins the page may be on
/// @returns `{ data, mimeType, url, tab }` with base64 JPEG data, or `{ blocked }`
#[tauri::command]
pub async fn browser_agent_screenshot(
    app: AppHandle,
    tab_id: String,
    allowed_origins: Vec<String>,
) -> Result<Value, String> {
    let webview = webview_for(&app, &tab_id)?;
    let native = match gate(&webview, &allowed_origins)? {
        Ok(url) => url,
        Err(blocked) => return Ok(blocked),
    };
    let check = json!({ "action": "check", "allowed": allowed_origins });
    let before = checked(
        run_script(&webview, &check).await?,
        &allowed_origins,
        &tab_id,
        &native,
    );
    if before.get("blocked").is_some() {
        return Ok(before);
    }
    let rx = crate::browser_capture::capture_page(&webview)?;
    let data = wait(rx).await??;
    let after = checked(
        run_script(&webview, &check).await?,
        &allowed_origins,
        &tab_id,
        &native,
    );
    if after.get("blocked").is_some() || after.get("url") != before.get("url") {
        return Err("the page changed while the screenshot was taken; try again".into());
    }
    Ok(json!({
        "data": data,
        "mimeType": "image/jpeg",
        "url": before.get("url"),
        "origin": before.get("origin"),
        "tab": tab_id,
        "nativeUrl": native.as_str(),
    }))
}
