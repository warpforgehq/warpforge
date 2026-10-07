//! Agent HTML renders (`docs/adr/0025`): `render_html` stores a page and shows
//! it in the task's chat; `render_preview` has the desktop screenshot one.

use serde_json::{json, Value};
use tokio::sync::oneshot;
use warpforge_protocol::html_render as limits;

use crate::daemon::actor::{Command, DaemonHandle};

pub(crate) mod inject;
mod preview;
pub(crate) mod store;

pub(crate) use preview::preview;

fn new_render_id() -> String {
    format!("r_{}", uuid::Uuid::new_v4().simple())
}

/// Store an agent's page and add it to the task's transcript.
/// @param handle the daemon actor
/// @param task_id the task whose chat shows the page
/// @param html the agent's page
/// @param title the page's name
/// @param height the frame height the agent asked for
/// @returns `{ render_id, title, height }`, or a message for the agent
pub(crate) async fn publish(
    handle: &DaemonHandle,
    task_id: String,
    html: String,
    title: String,
    height: f64,
) -> Result<Value, String> {
    limits::validate_html(&html)?;
    let title = limits::validate_title(&title)?;
    let height = limits::clamp_height(height);
    let render_id = new_render_id();
    let page = inject::inject_bootstrap(&html, None);

    let (task, id) = (task_id.clone(), render_id.clone());
    tokio::task::spawn_blocking(move || store::write(&task, &id, &page))
        .await
        .map_err(|e| e.to_string())??;

    let (tx, rx) = oneshot::channel();
    handle
        .send(Command::HtmlRenderPublish {
            task_id: task_id.clone(),
            render_id: render_id.clone(),
            title: title.clone(),
            height,
            reply: tx,
        })
        .await;
    let published = rx
        .await
        .unwrap_or_else(|_| Err("the daemon is shutting down".into()));
    if let Err(error) = published {
        let id = render_id.clone();
        let _ = tokio::task::spawn_blocking(move || store::remove(&task_id, &id)).await;
        return Err(error);
    }
    Ok(json!({ "render_id": render_id, "title": title, "height": height }))
}
