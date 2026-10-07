//! `render_preview`: the desktop app loads the page the way the chat frames
//! it and screenshots it. There is no headless browser in the daemon, so with
//! no app connected there is no preview.

use std::time::Duration;

use serde_json::Value;
use warpforge_protocol::{self as wire, html_render as limits};

use super::inject::inject_bootstrap;
use crate::daemon::server::{ClientHub, ClientRequestError};

/// Covers the desktop's own load wait and capture.
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(30);

/// Screenshot an agent's page in the desktop app.
/// @param clients the connected clients, one of which owns the browser
/// @param html the agent's page
/// @param width the viewport width asked for, if any
/// @param appearance `light` or `dark`; the app's current one when absent
/// @returns the desktop's result, or a message for the agent
pub(crate) async fn preview(
    clients: &ClientHub,
    html: String,
    width: Option<i64>,
    appearance: Option<String>,
) -> Result<Value, String> {
    limits::validate_html(&html)?;
    let appearance = match appearance.as_deref() {
        None | Some("") => None,
        Some(mode @ ("light" | "dark")) => Some(mode.to_string()),
        Some(other) => return Err(format!("appearance must be light or dark, not '{other}'")),
    };
    let body = wire::ClientRequestBody::HtmlPreview {
        html: inject_bootstrap(&html, Some(limits::PREVIEW_CONSOLE_JS)),
        width: limits::clamp_width(width),
        appearance,
    };
    clients
        .request(body, PREVIEW_TIMEOUT)
        .await
        .map_err(explain)
}

fn explain(error: ClientRequestError) -> String {
    match error {
        ClientRequestError::NoClient => "preview unavailable: the Warpforge desktop app is not \
             connected. render_html still works — publish without a preview, or ask the user \
             to open the app."
            .into(),
        ClientRequestError::Disconnected => "preview unavailable: the desktop app disconnected \
             before it finished. render_html still works."
            .into(),
        ClientRequestError::TimedOut => format!(
            "preview unavailable: the desktop app did not finish within {}s. render_html still \
             works.",
            PREVIEW_TIMEOUT.as_secs()
        ),
        ClientRequestError::Failed(message) => message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_app_says_render_html_still_works() {
        let message = explain(ClientRequestError::NoClient);
        assert!(message.starts_with("preview unavailable"), "{message}");
        assert!(message.contains("render_html still works"), "{message}");
        for error in [
            ClientRequestError::Disconnected,
            ClientRequestError::TimedOut,
        ] {
            assert!(explain(error).contains("render_html still works"));
        }
        assert_eq!(explain(ClientRequestError::Failed("boom".into())), "boom");
    }

    #[tokio::test]
    async fn bad_input_is_refused_before_any_client_is_asked() {
        let clients = ClientHub::default();
        let error = preview(&clients, " ".into(), None, None).await.unwrap_err();
        assert!(error.contains("empty"), "{error}");
        let error = preview(&clients, "<p>x</p>".into(), None, Some("sepia".into()))
            .await
            .unwrap_err();
        assert!(error.contains("light or dark"), "{error}");
        let error = preview(&clients, "<p>x</p>".into(), None, None)
            .await
            .unwrap_err();
        assert!(error.contains("not connected"), "{error}");
    }
}
