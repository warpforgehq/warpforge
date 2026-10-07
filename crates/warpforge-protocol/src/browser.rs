//! Daemon → client requests, and the in-app browser actions that use them.
//!
//! A client that can do something only it can (the desktop app owns the
//! browser's native views) says so with `client.register`. The daemon then
//! sends it a `client.request` event and waits for its `client.reply`.

use serde::{Deserialize, Serialize};

/// Capability a client registers to receive [`ClientRequestBody::Browser`].
pub const BROWSER_CAPABILITY: &str = "browser";

/// What an agent asks the project's in-app browser to do.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum BrowserAction {
    /// A compact outline of the page, interactive elements tagged with refs.
    Snapshot,
    /// Click the element a snapshot tagged `target`.
    Click {
        #[serde(rename = "ref")]
        target: String,
    },
    /// Replace the value of the element tagged `target`; `submit` then presses
    /// Enter the way a user would.
    Type {
        #[serde(rename = "ref")]
        target: String,
        text: String,
        #[serde(default)]
        submit: bool,
    },
    /// Load `url` in the project's active tab, opening one when there is none.
    Navigate { url: String },
    /// A picture of the visible part of the page.
    Screenshot,
    /// The page's recent console messages and uncaught errors.
    Console,
}

impl BrowserAction {
    /// The action's wire name.
    /// @returns the `action` tag, e.g. `click`
    pub fn name(&self) -> &'static str {
        match self {
            BrowserAction::Snapshot => "snapshot",
            BrowserAction::Click { .. } => "click",
            BrowserAction::Type { .. } => "type",
            BrowserAction::Navigate { .. } => "navigate",
            BrowserAction::Screenshot => "screenshot",
            BrowserAction::Console => "console",
        }
    }
}

/// The work a `client.request` asks a client to do.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ClientRequestBody {
    /// Act in `project`'s active browser tab. The client refuses with
    /// `{ "blocked": "<origin>" }` when the page is on an origin outside
    /// `allowed_origins`, checked right before it acts.
    Browser {
        project: String,
        action: BrowserAction,
        allowed_origins: Vec<String>,
    },
    /// Screenshot an agent's HTML page at `width`, in the app's theme for
    /// `appearance` (the app's current one when absent).
    HtmlPreview {
        html: String,
        width: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        appearance: Option<String>,
    },
}

impl ClientRequestBody {
    /// The capability a client must have registered to be sent this body.
    /// @returns the capability name
    pub fn capability(&self) -> &'static str {
        match self {
            // Served by the same app that owns the browser; a connection's
            // registration replaces its whole capability list.
            ClientRequestBody::Browser { .. } | ClientRequestBody::HtmlPreview { .. } => {
                BROWSER_CAPABILITY
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn actions_use_the_names_the_tools_do() {
        let click: BrowserAction =
            serde_json::from_value(json!({ "action": "click", "ref": "e3" })).unwrap();
        assert_eq!(
            click,
            BrowserAction::Click {
                target: "e3".into()
            }
        );
        let typed: BrowserAction =
            serde_json::from_value(json!({ "action": "type", "ref": "e1", "text": "hi" })).unwrap();
        assert_eq!(
            typed,
            BrowserAction::Type {
                target: "e1".into(),
                text: "hi".into(),
                submit: false
            }
        );
        assert_eq!(
            serde_json::to_value(BrowserAction::Snapshot).unwrap(),
            json!({ "action": "snapshot" })
        );
    }

    #[test]
    fn a_browser_body_is_tagged_by_kind() {
        let body = ClientRequestBody::Browser {
            project: "demo".into(),
            action: BrowserAction::Console,
            allowed_origins: vec!["http://localhost:4000".into()],
        };
        assert_eq!(
            serde_json::to_value(&body).unwrap(),
            json!({
                "kind": "browser",
                "project": "demo",
                "action": { "action": "console" },
                "allowed_origins": ["http://localhost:4000"],
            })
        );
        assert_eq!(body.capability(), BROWSER_CAPABILITY);
    }

    #[test]
    fn an_html_preview_goes_to_the_browser_owner() {
        let body = ClientRequestBody::HtmlPreview {
            html: "<p>x</p>".into(),
            width: 720,
            appearance: Some("dark".into()),
        };
        let value = serde_json::to_value(&body).unwrap();
        assert_eq!(
            value,
            json!({ "kind": "html_preview", "html": "<p>x</p>", "width": 720, "appearance": "dark" })
        );
        assert_eq!(
            serde_json::from_value::<ClientRequestBody>(value).unwrap(),
            body
        );
        assert_eq!(body.capability(), BROWSER_CAPABILITY);
    }
}
