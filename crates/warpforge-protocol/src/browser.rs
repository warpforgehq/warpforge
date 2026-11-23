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
    Snapshot {
        /// Outline only actionable elements and the structure that places them.
        #[serde(default, skip_serializing_if = "is_false")]
        interactive: bool,
        /// Outline only the subtree the ref in `scope` names.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        scope: Option<String>,
        /// Print only the page's headings and group lines, to map a long page.
        #[serde(default, skip_serializing_if = "is_false")]
        headings: bool,
    },
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
    /// Press `key` on the element `ref` names, the focused element, or the body.
    Press {
        key: String,
        #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
        target: Option<String>,
    },
    /// Scroll `ref` into view, to the top or bottom, or by whole pages.
    Scroll {
        #[serde(rename = "ref", default, skip_serializing_if = "Option::is_none")]
        target: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        to: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pages: Option<f64>,
    },
    /// Wait for text to appear or go, or for the element `ref_gone` to be
    /// removed or hidden.
    Wait {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        text: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        gone: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        ref_gone: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timeout_ms: Option<u64>,
    },
    /// Load `url` in the project's active tab, opening one when there is none.
    Navigate { url: String },
    /// A picture of the visible part of the page.
    Screenshot,
    /// The page's recent console messages and uncaught errors.
    Console,
}

fn is_false(value: &bool) -> bool {
    !*value
}

impl BrowserAction {
    /// The action's wire name.
    /// @returns the `action` tag, e.g. `click`
    pub fn name(&self) -> &'static str {
        match self {
            BrowserAction::Snapshot { .. } => "snapshot",
            BrowserAction::Click { .. } => "click",
            BrowserAction::Type { .. } => "type",
            BrowserAction::Press { .. } => "press",
            BrowserAction::Scroll { .. } => "scroll",
            BrowserAction::Wait { .. } => "wait",
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
            serde_json::to_value(BrowserAction::Snapshot {
                interactive: false,
                scope: None,
                headings: false,
            })
            .unwrap(),
            json!({ "action": "snapshot" })
        );
        assert_eq!(
            serde_json::to_value(BrowserAction::Snapshot {
                interactive: true,
                scope: Some("e3".into()),
                headings: false,
            })
            .unwrap(),
            json!({ "action": "snapshot", "interactive": true, "scope": "e3" })
        );
    }

    #[test]
    fn a_snapshot_without_modes_round_trips_and_accepts_them() {
        let plain: BrowserAction = serde_json::from_value(json!({ "action": "snapshot" })).unwrap();
        assert_eq!(
            plain,
            BrowserAction::Snapshot {
                interactive: false,
                scope: None,
                headings: false,
            }
        );
        let scoped: BrowserAction = serde_json::from_value(
            json!({ "action": "snapshot", "interactive": true, "scope": "e7" }),
        )
        .unwrap();
        assert_eq!(
            scoped,
            BrowserAction::Snapshot {
                interactive: true,
                scope: Some("e7".into()),
                headings: false,
            }
        );
        let headings: BrowserAction =
            serde_json::from_value(json!({ "action": "snapshot", "headings": true })).unwrap();
        assert_eq!(
            headings,
            BrowserAction::Snapshot {
                interactive: false,
                scope: None,
                headings: true,
            }
        );
        assert_eq!(
            serde_json::to_value(BrowserAction::Snapshot {
                interactive: false,
                scope: None,
                headings: true,
            })
            .unwrap(),
            json!({ "action": "snapshot", "headings": true })
        );
    }

    #[test]
    fn press_scroll_and_wait_round_trip_with_their_optional_fields() {
        let press: BrowserAction =
            serde_json::from_value(json!({ "action": "press", "key": "Escape" })).unwrap();
        assert_eq!(
            press,
            BrowserAction::Press {
                key: "Escape".into(),
                target: None
            }
        );
        assert_eq!(
            serde_json::to_value(BrowserAction::Press {
                key: "Enter".into(),
                target: Some("e2".into()),
            })
            .unwrap(),
            json!({ "action": "press", "key": "Enter", "ref": "e2" })
        );
        let scroll: BrowserAction =
            serde_json::from_value(json!({ "action": "scroll", "pages": 2 })).unwrap();
        assert_eq!(
            scroll,
            BrowserAction::Scroll {
                target: None,
                to: None,
                pages: Some(2.0)
            }
        );
        assert_eq!(
            serde_json::to_value(BrowserAction::Scroll {
                target: Some("e4".into()),
                to: None,
                pages: None,
            })
            .unwrap(),
            json!({ "action": "scroll", "ref": "e4" })
        );
        let wait: BrowserAction = serde_json::from_value(
            json!({ "action": "wait", "text": "Saved", "timeout_ms": 3000 }),
        )
        .unwrap();
        assert_eq!(
            wait,
            BrowserAction::Wait {
                text: Some("Saved".into()),
                gone: None,
                ref_gone: None,
                timeout_ms: Some(3000)
            }
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
