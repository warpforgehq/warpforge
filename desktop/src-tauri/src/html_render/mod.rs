//! `wf-render://`: serves agent HTML renders to the chat's sandboxed iframes,
//! and preview pages to their own preview webview (`docs/adr/0025`).
//!
//! Tauri treats every registered scheme as local, and app commands have no
//! ACL, so a page from this scheme must never be a webview's main frame. The
//! label gate below serves a page only to the webview that frames it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

pub(crate) mod preview;

pub(crate) const SCHEME: &str = "wf-render";

/// The page's own policy: inline and https scripts, styles, images and fonts,
/// and no network access beyond loading them.
pub(crate) const RENDER_CSP: &str = "default-src 'none'; script-src 'unsafe-inline' https:; \
     style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:";

const MAIN_WEBVIEW: &str = "main";

/// Preview pages waiting to be loaded, by preview id.
#[derive(Default)]
pub(crate) struct PreviewPages(pub(crate) Mutex<HashMap<String, String>>);

#[derive(Debug, PartialEq, Eq)]
enum Target {
    Render { task: String, render: String },
    Preview(String),
}

fn is_plain(part: &str) -> bool {
    !part.is_empty()
        && part != "."
        && part != ".."
        && part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// The label of the webview a preview page is served to.
/// @param id the preview id
/// @returns the label
pub(crate) fn preview_label(id: &str) -> String {
    format!("html-preview:{id}")
}

/// What a request may load, given the webview that made it.
/// @returns the page, or the status to refuse with
fn route(label: &str, path: &str) -> Result<Target, StatusCode> {
    let parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();
    let target = match parts.as_slice() {
        ["preview", id] if is_plain(id) => Target::Preview(id.to_string()),
        [task, file] => match file.strip_suffix(".html") {
            Some(render) if is_plain(task) && is_plain(render) => Target::Render {
                task: task.to_string(),
                render: render.to_string(),
            },
            _ => return Err(StatusCode::NOT_FOUND),
        },
        _ => return Err(StatusCode::NOT_FOUND),
    };
    let allowed = match &target {
        Target::Render { .. } => label == MAIN_WEBVIEW,
        Target::Preview(id) => label == preview_label(id),
    };
    if allowed {
        Ok(target)
    } else {
        Err(StatusCode::FORBIDDEN)
    }
}

/// Where the daemon writes renders; mirrors its `registry::warpforge_dir`.
fn renders_dir() -> Option<PathBuf> {
    let home = match std::env::var_os("WARPFORGE_HOME") {
        Some(dir) => PathBuf::from(dir),
        None => dirs::home_dir()?.join(".warpforge"),
    };
    Some(home.join("renders"))
}

fn page(html: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .header(header::CONTENT_SECURITY_POLICY, RENDER_CSP)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-cache")
        .body(html)
        .unwrap_or_else(|_| refusal(StatusCode::INTERNAL_SERVER_ERROR))
}

fn refusal(status: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = status;
    response
}

/// The scheme handler registered in `main.rs`.
pub(crate) fn serve<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let target = match route(ctx.webview_label(), request.uri().path()) {
        Ok(target) => target,
        Err(status) => return responder.respond(refusal(status)),
    };
    match target {
        Target::Preview(id) => {
            let html = ctx
                .app_handle()
                .try_state::<PreviewPages>()
                .and_then(|pages| pages.0.lock().ok()?.get(&id).cloned());
            responder.respond(match html {
                Some(html) => page(html.into_bytes()),
                None => refusal(StatusCode::NOT_FOUND),
            });
        }
        Target::Render { task, render } => {
            std::thread::spawn(move || {
                let file = renders_dir().map(|dir| dir.join(task).join(format!("{render}.html")));
                responder.respond(match file.map(std::fs::read) {
                    Some(Ok(html)) => page(html),
                    _ => refusal(StatusCode::NOT_FOUND),
                });
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_go_to_the_main_webview_and_previews_to_their_own() {
        assert_eq!(
            route("main", "/t_1/r_abc.html"),
            Ok(Target::Render {
                task: "t_1".into(),
                render: "r_abc".into()
            })
        );
        assert_eq!(
            route("html-preview:p1", "/preview/p1"),
            Ok(Target::Preview("p1".into()))
        );
        assert_eq!(route("main", "/preview/p1"), Err(StatusCode::FORBIDDEN));
        assert_eq!(
            route("html-preview:p2", "/preview/p1"),
            Err(StatusCode::FORBIDDEN)
        );
        assert_eq!(
            route("html-preview:p1", "/t_1/r_abc.html"),
            Err(StatusCode::FORBIDDEN)
        );
        for label in ["browser:demo:1", "browser:x"] {
            assert_eq!(route(label, "/t_1/r_abc.html"), Err(StatusCode::FORBIDDEN));
            assert_eq!(route(label, "/preview/p1"), Err(StatusCode::FORBIDDEN));
        }
    }

    #[test]
    fn paths_outside_the_layout_are_not_found() {
        for path in [
            "/../r.html",
            "/t_1/../r.html",
            "/t_1/r",
            "/t_1/a/r.html",
            "/t_1/%2e%2e.html",
            "/",
            "/preview/..",
        ] {
            assert_eq!(route("main", path), Err(StatusCode::NOT_FOUND), "{path}");
        }
    }

    #[test]
    fn the_page_policy_allows_no_connections() {
        assert!(RENDER_CSP.starts_with("default-src 'none';"));
        assert!(!RENDER_CSP.contains("connect-src"));
        assert!(!RENDER_CSP.contains("frame-src"));
    }

    /// Commands have no ACL here, so a capability is the only thing that
    /// could expose them beyond the main window's own frontend: a `remote`
    /// entry or a broader window list would reach render or preview pages.
    #[test]
    fn no_capability_reaches_a_render_or_preview() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../../capabilities/default.json")).unwrap();
        let object = capability.as_object().unwrap();
        assert!(!object.contains_key("remote"));
        assert!(!object.contains_key("webviews"));
        assert_eq!(capability["windows"], serde_json::json!(["main"]));
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities");
        let files: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(files, vec![std::ffi::OsString::from("default.json")]);
    }
}
