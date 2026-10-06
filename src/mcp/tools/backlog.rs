use serde_json::{json, Value};

use crate::mcp::handle::{PRIORITIES, STATUSES, TRACKERS};

pub(super) fn defs() -> Vec<Value> {
    vec![
        json!({
            "name": "create_backlog_task",
            "description": "Create a backlog item for follow-up work. It is recorded in the project's backlog and does not start an agent. With `tracker` it also opens a linked issue in GitHub or Linear.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Project name. Defaults to the current project."
                    },
                    "tracker": {
                        "type": "string",
                        "enum": TRACKERS,
                        "description": "Also create the issue in this tracker and link it to the item. Set it only when the user explicitly asks for a GitHub or Linear issue; omit it for a local item."
                    },
                    "title": {
                        "type": "string",
                        "description": "Short backlog item title. Required unless the legacy prompt is given."
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
                }
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
        json!({
            "name": "list_backlog_tasks",
            "description": "List backlog items, most recently changed first, one per line as `#number [status] [priority] title`, plus the total. Use get_backlog_task for the full text of one item.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string", "description": "Project name. Defaults to the current project." },
                    "status": { "type": "string", "enum": STATUSES, "description": "Only items with this status." },
                    "priority": { "type": "string", "enum": PRIORITIES, "description": "Only items with this priority." },
                    "search": { "type": "string", "description": "Only items whose title or body contains this text." },
                    "limit": { "type": "integer", "description": "Maximum items to list, 1 to 100. Defaults to 50." }
                }
            }
        }),
        json!({
            "name": "get_backlog_task",
            "description": "Read one backlog item in full: title, body, status, priority, and its linked task or external tracker URL. Give the number a user writes as #87, or the item id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "number": { "type": "integer", "description": "The item number, as in #87. Give number or id." },
                    "id": { "type": "string", "description": "The item id. Give number or id." },
                    "project": { "type": "string", "description": "Project name. Defaults to the current project." }
                }
            }
        }),
        json!({
            "name": "update_backlog_task",
            "description": "Change a backlog item. Only the fields you give change; the rest stay as they are. Returns the updated item.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "number": { "type": "integer", "description": "The item number, as in #87. Give number or id." },
                    "id": { "type": "string", "description": "The item id. Give number or id." },
                    "project": { "type": "string", "description": "Project name. Defaults to the current project." },
                    "title": { "type": "string", "description": "New title." },
                    "body": { "type": "string", "description": "New body. Replaces the whole body." },
                    "status": { "type": "string", "enum": STATUSES, "description": "New status." },
                    "priority": { "type": "string", "enum": PRIORITIES, "description": "New priority." }
                }
            }
        }),
        json!({
            "name": "close_backlog_task",
            "description": "Close a backlog item: sets its status to done, or to cancelled when it will not be done. An optional note is appended to the body as `Closed: <note>`.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "number": { "type": "integer", "description": "The item number, as in #87. Give number or id." },
                    "id": { "type": "string", "description": "The item id. Give number or id." },
                    "project": { "type": "string", "description": "Project name. Defaults to the current project." },
                    "status": { "type": "string", "enum": ["done", "cancelled"], "description": "done (default) for finished work, cancelled for work that will not be done." },
                    "note": { "type": "string", "description": "Short closing note appended to the body." }
                }
            }
        }),
    ]
}
