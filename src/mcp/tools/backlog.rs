use serde_json::{json, Value};

pub(super) fn defs() -> Vec<Value> {
    vec![
        json!({
            "name": "create_backlog_task",
            "description": "Create a local backlog item for follow-up work. It is recorded in the project's backlog and does not start an agent.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Project name. Defaults to the current project."
                    },
                    "title": {
                        "type": "string",
                        "description": "Short backlog item title."
                    },
                    "prompt": {
                        "type": "string",
                        "description": "Legacy alias for title; use title for new calls."
                    },
                    "body": {
                        "type": "string",
                        "description": "Optional detailed description or acceptance notes."
                    },
                    "priority": {
                        "type": "string",
                        "description": "Optional priority, such as none, low, medium, high, or urgent."
                    },
                    "status": {
                        "type": "string",
                        "description": "Optional backlog status. Defaults to todo."
                    }
                },
                "anyOf": [{ "required": ["title"] }, { "required": ["prompt"] }]
            }
        }),
        json!({
            "name": "create_task",
            "description": "Deprecated alias for create_backlog_task. Creates a local backlog item and does not start an agent.",
            "deprecated": true,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "Project name. Defaults to the current project." },
                    "prompt": { "type": "string", "description": "Backlog item title." },
                    "body": { "type": "string", "description": "Optional detailed description or acceptance notes." },
                    "priority": { "type": "string", "description": "Optional priority." },
                    "status": { "type": "string", "description": "Optional backlog status. Defaults to todo." },
                    "agent": { "type": "string", "description": "Ignored; retained for compatibility." },
                    "workflow": { "type": "string", "description": "Ignored; retained for compatibility." }
                },
                "required": ["prompt"]
            }
        }),
    ]
}
