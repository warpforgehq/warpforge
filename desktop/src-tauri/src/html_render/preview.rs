//! `render_preview`'s capture: the agent's page in a sandboxed iframe, framed
//! by a `data:` host page in a child webview of its own, off the visible area.
//! The host's origin is remote to Tauri, so it can call no app command, and
//! the page itself never runs as a main frame (ADR 0025).

use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl};

use super::{preview_label, PreviewPages, SCHEME};

const HOST_WINDOW: &str = "main";
const MIN_WIDTH: u32 = 240;
const MAX_WIDTH: u32 = 1600;
const INITIAL_HEIGHT: u32 = 800;
/// Tallest capture, in CSS pixels; a longer page is cut off there.
const MAX_CAPTURE_HEIGHT: u32 = 4000;
const LOAD_TIMEOUT: Duration = Duration::from_secs(8);
const POLL: Duration = Duration::from_millis(100);
/// Polls the reported height must hold for before it counts as settled.
const STABLE_POLLS: u32 = 3;

/// The host page; `{SRC}` is the framed page's URL. It records the frame's
/// load, its last reported height and its console problems for `__wfPreview`.
const HOST_PAGE: &str = r#"<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}iframe{display:block;border:0;width:100%;height:800px}</style></head><body><iframe id="f" sandbox="allow-scripts allow-forms" src="{SRC}"></iframe><script>(function(){var f=document.getElementById("f"),st={loaded:false,height:0,messages:[]};f.addEventListener("load",function(){st.loaded=true;});window.addEventListener("message",function(e){if(e.source!==f.contentWindow)return;var d=e.data,p=d&&d.params;if(!d||d.jsonrpc!=="2.0"||!p)return;if(d.method==="ui/notifications/size-changed"&&typeof p.height==="number"&&isFinite(p.height)&&p.height>0){st.height=Math.ceil(p.height);f.style.height=Math.min(st.height,4000)+"px";}else if(d.method==="notifications/message"&&st.messages.length<20){st.messages.push({level:String(p.level),text:String(p.data).slice(0,500)});}});window.__wfPreview=function(){return JSON.stringify(st);};})();</script></body></html>"#;

#[derive(serde::Deserialize, Default)]
struct HostState {
    loaded: bool,
    height: u32,
    messages: Vec<Value>,
}

/// Removes the stored page and closes the preview webview however the
/// preview ends.
struct Cleanup {
    app: AppHandle,
    id: String,
    webview: Option<Webview>,
}

impl Drop for Cleanup {
    fn drop(&mut self) {
        if let Some(pages) = self.app.try_state::<PreviewPages>() {
            if let Ok(mut pages) = pages.0.lock() {
                pages.remove(&self.id);
            }
        }
        if let Some(webview) = self.webview.take() {
            let _ = webview.close();
        }
    }
}

fn frame_src(id: &str, fragment: &str) -> String {
    let base = if cfg!(windows) {
        format!("http://{SCHEME}.localhost")
    } else {
        format!("{SCHEME}://localhost")
    };
    format!("{base}/preview/{id}{fragment}")
}

/// A theme fragment as the web side builds it: `#wf-theme=` and URI-encoded
/// JSON, so nothing in it can leave the attribute it is written into.
fn is_theme_fragment(fragment: &str) -> bool {
    fragment.strip_prefix("#wf-theme=").is_some_and(|rest| {
        rest.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '%' | '-' | '_' | '.' | '!' | '~' | '*' | '(' | ')')
        })
    })
}

fn host_page(src: &str) -> String {
    HOST_PAGE.replace("{SRC}", src)
}

fn data_url(html: &str) -> String {
    let mut url = String::from("data:text/html;charset=utf-8,");
    for byte in html.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            url.push(byte as char);
        } else {
            url.push_str(&format!("%{byte:02X}"));
        }
    }
    url
}

/// The preview webview loads only its host page and the framed page; the
/// hook also sees the iframe's own loads.
fn may_navigate(url: &Url) -> bool {
    match url.scheme() {
        "data" | "about" => true,
        s if s == SCHEME => true,
        "http" => url.host_str() == Some(&format!("{SCHEME}.localhost")),
        _ => false,
    }
}

async fn pause(duration: Duration) {
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

async fn read_state(webview: &Webview) -> Result<HostState, String> {
    let (tx, rx) = mpsc::channel();
    let tx = Mutex::new(Some(tx));
    webview
        .eval_with_callback(
            "window.__wfPreview ? window.__wfPreview() : null",
            move |raw| {
                if let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) {
                    let _ = tx.send(raw);
                }
            },
        )
        .map_err(|e| e.to_string())?;
    let raw = tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(2)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "the preview did not answer".to_string())?;
    // The callback hands back the script's string result JSON-encoded.
    Ok(serde_json::from_str::<String>(&raw)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default())
}

/// Wait for the page to load and its height to settle.
async fn settle(webview: &Webview) -> Result<HostState, String> {
    let started = Instant::now();
    let mut last = HostState::default();
    let mut stable = 0;
    while started.elapsed() < LOAD_TIMEOUT {
        pause(POLL).await;
        let state = read_state(webview).await?;
        if state.loaded && state.height > 0 && state.height == last.height {
            stable += 1;
            if stable >= STABLE_POLLS {
                return Ok(state);
            }
        } else {
            stable = 0;
        }
        last = state;
    }
    if !last.loaded {
        return Err(format!(
            "the page did not finish loading within {}s",
            LOAD_TIMEOUT.as_secs()
        ));
    }
    if last.height == 0 {
        last.height = INITIAL_HEIGHT;
    }
    Ok(last)
}

/// Screenshot an agent's page as the chat would show it.
/// @param html the page, bootstrap and console reporter already injected
/// @param width the viewport width in CSS pixels
/// @param fragment the theme fragment the chat's frames use
/// @returns `{ data, mimeType, width, contentHeight, capturedHeight, messages }`
#[tauri::command]
pub async fn html_preview(
    app: AppHandle,
    html: String,
    width: u32,
    fragment: String,
) -> Result<Value, String> {
    if !cfg!(target_os = "macos") {
        return Err("render_preview is available on macOS only; render_html still works".into());
    }
    if !is_theme_fragment(&fragment) {
        return Err("invalid theme fragment".into());
    }
    let width = width.clamp(MIN_WIDTH, MAX_WIDTH);
    let id = format!(
        "p{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or_default()
    );
    app.state::<PreviewPages>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.clone(), html);
    let mut cleanup = Cleanup {
        app: app.clone(),
        id: id.clone(),
        webview: None,
    };

    let window = app
        .get_window(HOST_WINDOW)
        .ok_or_else(|| "main window is not available".to_string())?;
    let host: Url = data_url(&host_page(&frame_src(&id, &fragment)))
        .parse()
        .map_err(|_| "invalid preview page".to_string())?;
    let builder = WebviewBuilder::new(preview_label(&id), WebviewUrl::External(host))
        .incognito(true)
        .focused(false)
        .on_navigation(may_navigate);
    // Outside the window's visible area but not hidden: a hidden view may
    // not render, and then the snapshot comes back empty.
    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(-f64::from(width) - 100.0, 0.0),
            LogicalSize::new(f64::from(width), f64::from(INITIAL_HEIGHT)),
        )
        .map_err(|e| e.to_string())?;
    cleanup.webview = Some(webview.clone());

    let state = settle(&webview).await?;
    let captured = state.height.clamp(1, MAX_CAPTURE_HEIGHT);
    webview
        .set_size(LogicalSize::new(f64::from(width), f64::from(captured)))
        .map_err(|e| e.to_string())?;
    pause(Duration::from_millis(150)).await;
    let rx = crate::browser_capture::capture_png(&webview, f64::from(width))?;
    let data =
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(10)))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|_| "the preview could not be captured in time".to_string())??;
    drop(cleanup);
    Ok(json!({
        "data": data,
        "mimeType": "image/png",
        "width": width,
        "contentHeight": state.height,
        "capturedHeight": captured,
        "messages": state.messages,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_host_frames_the_page_sandboxed_without_same_origin() {
        let page = host_page(&frame_src("p1", "#wf-theme=%7B%7D"));
        assert!(page.contains(r#"<iframe id="f" sandbox="allow-scripts allow-forms" src=""#));
        assert!(!page.contains("allow-same-origin"));
        let expected = if cfg!(windows) {
            "http://wf-render.localhost/preview/p1#wf-theme=%7B%7D"
        } else {
            "wf-render://localhost/preview/p1#wf-theme=%7B%7D"
        };
        assert!(page.contains(expected), "{page}");
    }

    #[test]
    fn only_a_uri_encoded_theme_fragment_is_accepted() {
        assert!(is_theme_fragment(
            "#wf-theme=%7B%22appearance%22%3A%22dark%22%7D"
        ));
        assert!(!is_theme_fragment("#wf-theme=\"><script>"));
        assert!(!is_theme_fragment("#other=1"));
        assert!(!is_theme_fragment("#wf-theme=a b"));
    }

    #[test]
    fn the_preview_loads_only_its_own_pages() {
        let ok = |url: &str| may_navigate(&url.parse().unwrap());
        assert!(ok("data:text/html,hi"));
        assert!(ok("wf-render://localhost/preview/p1"));
        assert!(ok("http://wf-render.localhost/preview/p1"));
        assert!(ok("about:blank"));
        assert!(!ok("https://example.com/"));
        assert!(!ok("http://localhost:4000/"));
        assert!(!ok("file:///etc/passwd"));
        assert!(!ok("tauri://localhost/"));
    }

    #[test]
    fn the_host_page_survives_the_data_url_encoding() {
        let url = data_url("<p a=\"b\">#%</p>");
        assert_eq!(
            url,
            "data:text/html;charset=utf-8,%3Cp%20a%3D%22b%22%3E%23%25%3C%2Fp%3E"
        );
    }
}
