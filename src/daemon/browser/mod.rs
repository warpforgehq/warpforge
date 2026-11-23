//! The agent's hands in the in-app browser. The desktop app owns the page and
//! runs the action; the daemon decides which origins the agent may act on and
//! asks the user about the rest (`docs/adr/0021`).

use std::time::Duration;

use serde_json::Value;
use warpforge_protocol as wire;

use crate::daemon::actor::DaemonHandle;
use crate::daemon::server::{ClientHub, ClientRequestError};

mod origins;

pub(crate) use origins::Grants;

/// How long the desktop has for one action, a page load or a reopened tab
/// included.
const ACTION_TIMEOUT: Duration = Duration::from_secs(40);
/// How long an approval prompt waits for the user before it is withdrawn.
pub(crate) const ASK_TIMEOUT: Duration = Duration::from_secs(300);

/// Run one browser action for the agent of `task_id`.
/// @param handle the daemon actor
/// @param clients the connected clients, one of which owns the browser
/// @param grants origins the user allowed for the rest of a task
/// @param project the project whose browser tab is driven
/// @param task_id the agent's task, where approval prompts appear
/// @param action what to do
/// @returns the desktop's result, or a message for the agent
pub(crate) async fn act(
    handle: &DaemonHandle,
    clients: &ClientHub,
    grants: &Grants,
    project: &str,
    task_id: &str,
    mut action: wire::BrowserAction,
) -> Result<Value, String> {
    let snapshot = handle.snapshot().await;
    if !snapshot.projects.iter().any(|p| p.name == project) {
        return Err(format!("no project named '{project}'"));
    }
    let mut allowed = origins::service_origins(&snapshot, project);
    allowed.extend(grants.of(task_id));

    let log = Log {
        task_id,
        project,
        action: action.name(),
    };
    if let wire::BrowserAction::Navigate { url } = &mut action {
        let (target, origin) = origins::web_url(url)?;
        *url = target;
        if allowed.contains(&origin) {
            log.decision(&origin, "allowed");
        } else {
            approve(handle, grants, task_id, &origin, &action, &log).await?;
            allowed.push(origin);
        }
    }

    // The desktop checks the page right before it acts. Its answer is checked
    // again here, so a result that does not name an allowed document is
    // treated as refused rather than handed to the agent.
    let mut approved = false;
    loop {
        let body = wire::ClientRequestBody::Browser {
            project: project.to_string(),
            action: action.clone(),
            allowed_origins: allowed.clone(),
        };
        let result = clients
            .request(body, ACTION_TIMEOUT)
            .await
            .map_err(|error| explain(error, &action))?;
        log.result(&result);
        if matches!(action, wire::BrowserAction::Navigate { .. }) {
            return Ok(navigated(result, &allowed));
        }
        let origin = match refused_origin(&result, &allowed) {
            None => {
                log.decision(field(&result, "origin"), "allowed");
                return Ok(keep_evidence(handle, task_id, &action, result).await);
            }
            Some(origin) => origin,
        };
        if origin == UNKNOWN {
            return Err(
                "the browser did not say which page it acted on, so nothing was returned".into(),
            );
        }
        if approved {
            return Err(format!(
                "the page moved to {origin} while waiting for approval; take a new browser_snapshot and try again"
            ));
        }
        approve(handle, grants, task_id, &origin, &action, &log).await?;
        allowed.push(origin);
        approved = true;
    }
}

const UNKNOWN: &str = "unknown";

/// A verify stage's screenshot is kept as workflow evidence, and the result
/// names it so the agent can cite it in its checklist.
async fn keep_evidence(
    handle: &DaemonHandle,
    task_id: &str,
    action: &wire::BrowserAction,
    mut result: Value,
) -> Value {
    let data = field(&result, "data").to_string();
    if !matches!(action, wire::BrowserAction::Screenshot) || task_id.is_empty() || data.is_empty() {
        return result;
    }
    let mime = match field(&result, "mimeType") {
        "" => "image/jpeg".to_string(),
        mime => mime.to_string(),
    };
    let Some((name, path)) = handle.keep_workflow_evidence(task_id, &mime).await else {
        return result;
    };
    let written =
        tokio::task::spawn_blocking(move || crate::daemon::workflow::evidence::write(&path, &data))
            .await
            .unwrap_or_else(|e| Err(e.to_string()));
    match written {
        Ok(()) => {
            if let Some(object) = result.as_object_mut() {
                object.insert("evidence".into(), Value::String(name));
            }
        }
        Err(error) => eprintln!("[browser] task={task_id} evidence {name} not kept: {error}"),
    }
    result
}

fn field<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

/// Query strings and fragments carry sign-in codes and tokens; the log keeps
/// only scheme, host and path.
fn without_query(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(mut parsed) => {
            parsed.set_query(None);
            parsed.set_fragment(None);
            parsed.to_string()
        }
        Err(_) => url.split(['?', '#']).next().unwrap_or("").to_string(),
    }
}

/// The origin a result must not be returned for: the one the desktop refused,
/// or the document's own when it is not allowed or not named at all.
fn refused_origin(result: &Value, allowed: &[String]) -> Option<String> {
    if let Some(blocked) = result.get("blocked").and_then(Value::as_str) {
        return Some(blocked.to_string());
    }
    match result.get("origin").and_then(Value::as_str) {
        Some(origin) if allowed.iter().any(|a| a == origin) => None,
        Some(origin) => Some(origin.to_string()),
        None => Some(UNKNOWN.to_string()),
    }
}

/// A navigation result, without the title of a page the agent may not read:
/// a redirect can land it on an origin nobody allowed.
fn navigated(mut result: Value, allowed: &[String]) -> Value {
    let landed = field(&result, "origin").to_string();
    if !allowed.contains(&landed) {
        if let Some(object) = result.as_object_mut() {
            object.remove("title");
            object.insert("unapproved".into(), Value::Bool(true));
        }
    }
    result
}

/// One line per browser action on the daemon's log, so a live session can be
/// diagnosed from what the desktop reported and what was decided.
struct Log<'a> {
    task_id: &'a str,
    project: &'a str,
    action: &'a str,
}

impl Log<'_> {
    fn result(&self, result: &Value) {
        eprintln!(
            "[browser] task={} project={} action={} tab={} native={} document={} blocked={}",
            self.task_id,
            self.project,
            self.action,
            field(result, "tab"),
            without_query(field(result, "nativeUrl")),
            without_query(field(result, "url")),
            field(result, "blocked"),
        );
    }

    fn decision(&self, origin: &str, decision: &str) {
        eprintln!(
            "[browser] task={} action={} origin={origin} decision={decision}",
            self.task_id, self.action
        );
    }
}

/// Ask the user whether the agent may act on `origin`, and wait for the answer.
async fn approve(
    handle: &DaemonHandle,
    grants: &Grants,
    task_id: &str,
    origin: &str,
    action: &wire::BrowserAction,
    log: &Log<'_>,
) -> Result<(), String> {
    if task_id.is_empty() {
        log.decision(origin, "refused: no task to ask on");
        return Err(format!(
            "{origin} is not one of this project's services, and this session has no Warpforge \
             task to ask the user on, so the action did not run"
        ));
    }
    let title = format!(
        "Let the agent {} on {origin} in the browser? It acts in your signed-in session; \
         \"allow always\" covers {origin} for the rest of this task.",
        verb(action)
    );
    let ask = handle
        .ask_user(task_id, &title, Some(origin))
        .await
        .inspect_err(|error| {
            log.decision(origin, &format!("refused: could not ask ({error})"));
        })?;
    log.decision(origin, &format!("asked request={}", ask.request_id));
    let outcome = match tokio::time::timeout(ASK_TIMEOUT, ask.answer).await {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(_)) => {
            log.decision(origin, "refused: prompt withdrawn");
            return Err(format!(
                "the approval prompt for {origin} was withdrawn, so the action did not run"
            ));
        }
        Err(_) => {
            log.decision(origin, "refused: no answer");
            handle.withdraw_ask(task_id, &ask.request_id).await;
            return Err(format!(
                "nobody answered the approval prompt for {origin} within {} minutes, so the action \
                 did not run",
                ASK_TIMEOUT.as_secs() / 60
            ));
        }
    };
    log.decision(origin, &format!("answer={outcome}"));
    match outcome.as_str() {
        "allow" => Ok(()),
        "allow_always" => {
            grants.add(task_id, origin);
            Ok(())
        }
        _ => Err(format!(
            "the user declined browser access to {origin}; the action did not run. Do not retry \
             it unless the user asks you to."
        )),
    }
}

fn verb(action: &wire::BrowserAction) -> &'static str {
    match action {
        wire::BrowserAction::Snapshot { .. } => "read the page",
        wire::BrowserAction::Click { .. } => "click",
        wire::BrowserAction::Type { .. } => "type",
        wire::BrowserAction::Press { .. } => "press a key",
        wire::BrowserAction::Scroll { .. } => "scroll",
        wire::BrowserAction::Wait { .. } => "wait for the page",
        wire::BrowserAction::Navigate { .. } => "open a page",
        wire::BrowserAction::Screenshot => "take a screenshot",
        wire::BrowserAction::Console => "read the console",
    }
}

fn explain(error: ClientRequestError, action: &wire::BrowserAction) -> String {
    match error {
        ClientRequestError::NoClient => "no Warpforge desktop app is connected, so there is no \
             browser to act in. Ask the user to open the app."
            .into(),
        ClientRequestError::Disconnected => {
            "the desktop app disconnected before it finished the action".into()
        }
        ClientRequestError::TimedOut => format!(
            "the browser did not finish {} within {}s",
            action.name(),
            ACTION_TIMEOUT.as_secs()
        ),
        ClientRequestError::Failed(message) => message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_result_is_refused_for_its_blocked_or_unapproved_or_unnamed_document() {
        let allowed = vec!["http://localhost:4400".to_string()];
        let ok = json!({ "origin": "http://localhost:4400", "tree": "x" });
        assert_eq!(refused_origin(&ok, &allowed), None);
        let blocked = json!({ "blocked": "https://a.test" });
        assert_eq!(
            refused_origin(&blocked, &allowed).as_deref(),
            Some("https://a.test")
        );
        let elsewhere = json!({ "origin": "https://www.google.com", "tree": "x" });
        assert_eq!(
            refused_origin(&elsewhere, &allowed).as_deref(),
            Some("https://www.google.com")
        );
        assert_eq!(
            refused_origin(&json!({ "tree": "x" }), &allowed).as_deref(),
            Some(UNKNOWN)
        );
    }

    #[test]
    fn a_navigation_that_lands_on_an_unapproved_site_hides_its_title() {
        let allowed = vec!["http://localhost:4400".to_string()];
        let landed = navigated(
            json!({ "origin": "https://login.test", "title": "Sign in", "url": "https://login.test/" }),
            &allowed,
        );
        assert_eq!(landed.get("title"), None);
        assert_eq!(landed["unapproved"], true);
        let home = navigated(
            json!({ "origin": "http://localhost:4400", "title": "Home" }),
            &allowed,
        );
        assert_eq!(home["title"], "Home");
    }

    #[test]
    fn every_new_action_has_a_verb_for_the_approval_prompt() {
        assert_eq!(
            verb(&wire::BrowserAction::Press {
                key: "Escape".into(),
                target: None
            }),
            "press a key"
        );
        assert_eq!(
            verb(&wire::BrowserAction::Scroll {
                target: None,
                to: None,
                pages: Some(1.0)
            }),
            "scroll"
        );
        assert_eq!(
            verb(&wire::BrowserAction::Wait {
                text: Some("Saved".into()),
                gone: None,
                ref_gone: None,
                timeout_ms: None
            }),
            "wait for the page"
        );
    }

    #[test]
    fn logged_urls_drop_query_and_fragment() {
        assert_eq!(
            without_query("https://login.test/cb?code=secret#token=x"),
            "https://login.test/cb"
        );
        assert_eq!(without_query("not a url?code=secret"), "not a url");
    }
}
