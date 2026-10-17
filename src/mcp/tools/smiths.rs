//! `start_work`, for a Smith's own sessions (ADR 0027): its thread and the
//! work sessions it starts.

use serde_json::{json, Value};

pub(super) fn defs() -> Vec<Value> {
    vec![json!({
        "name": "start_work",
        "description": "Start a work session as a Smith: a task on the board, with its own \
            worktree, that runs as that Smith with its soul and journal. Use it when the user \
            asked for a change and it fits; put unclear or large work on the board instead \
            (create_backlog_task). The session reports back to you once, when it settles. The \
            daemon refuses past its limits — two start_work hops deep, three open work \
            sessions per Smith, the Smith's projects, holds, budget and quota — and the error \
            names the rule: do not retry it.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "smith": {
                    "type": "string",
                    "description": "\"self\", or another Smith's name. Give another Smith work only with a reason."
                },
                "project": {
                    "type": "string",
                    "description": "Project to work in. Defaults to this session's project."
                },
                "brief": {
                    "type": "string",
                    "description": "The assignment: what to do, what done looks like, and the role it asks for (implement, review, fix, triage)."
                },
                "item": {
                    "type": "integer",
                    "description": "Optional board item number, as in #87, to link the session to."
                }
            },
            "required": ["smith", "brief"]
        }
    })]
}
