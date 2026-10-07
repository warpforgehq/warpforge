use serde_json::{json, Value};

/// What an advisor's own session may call: everything that reads, nothing
/// that starts, stops, stores or acts. Rendering a page only adds to the
/// caller's own chat, so it counts as read-only.
pub(crate) const READ_ONLY_TOOLS: &[&str] = &[
    "list_runtime",
    "read_service_logs",
    "read_portforward_logs",
    "memory_search",
    "memory_list",
    "memory_stats",
    "memory_edges",
    "automation_list",
    "automation_get",
    "automation_runs",
    "render_html",
    "render_preview",
];

pub(super) fn defs() -> Vec<Value> {
    vec![json!({
        "name": "ask_advisor",
        "description": "Consult this task's advisor: a second agent (often another harness \
            or a stronger model) with a read-only view of this checkout. It already sees the \
            task's goal, the messages since your last question and the changed files, and it \
            remembers its earlier advice. Ask before a big design decision, when stuck after \
            a couple of failed attempts, and before declaring the task done. Blocks until it \
            answers; if the reply says the advisor is still working, call again with \
            wait: true. At most three questions per turn.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The question itself: what you are deciding or stuck on, and what you need back."
                },
                "context": {
                    "type": "string",
                    "description": "Optional: what you tried, the error, the options you are weighing."
                },
                "wait": {
                    "type": "boolean",
                    "description": "Keep waiting for the answer to your pending question instead of asking a new one."
                }
            }
        }
    })]
}
