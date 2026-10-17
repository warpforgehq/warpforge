//! The peer tools every session but an advisor gets (ADR 0026): who else is
//! working here, a way to reach them, and a note saying what this session does.

use serde_json::{json, Value};

pub(super) fn defs() -> Vec<Value> {
    vec![
        json!({
            "name": "list_agents",
            "description": "List the other Warpforge sessions you can talk to, across every \
                harness (Claude, Codex, …), by task title — not this harness's own built-in \
                agents. Each entry has a relation: `child` for a sub-agent you spawned (an \
                orchestrator only), `peer` for another session working in this project, with \
                its status and the note it set about what it is doing, then the channels you \
                can post to. Message any of them with message_agent.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Optional project name for the sub-agents. Defaults to this session's project."
                    }
                }
            }
        }),
        json!({
            "name": "message_agent",
            "description": "Send a message to another Warpforge session (any harness), named by \
                the task id list_agents gives. A sub-agent you spawned gets it as a follow-up \
                and its result reaches your inbox (read_inbox). A peer gets it as its next turn \
                — a busy peer when it is free, an idle one when it is next resumed — and \
                answers with message_agent if it wants to. task_id \"team\" posts to the \
                project's team channel instead: it wakes nobody, and every peer reads it with \
                its next prompt; a peer the post @mentions (by title or task id) is also sent it \
                as a direct message. \"#name\" posts to a named channel you are a member of \
                (list_agents lists them; \"#general\" is the team channel); only the user \
                creates channels and adds members. The daemon limits how often sessions message each other; a \
                refusal names the rule — do not retry it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "The session's task id from list_agents or spawn_agent, \"team\" for the team channel, or \"#name\" for a named channel."
                    },
                    "message": {
                        "type": "string",
                        "description": "What to say, at most 4,000 characters."
                    }
                },
                "required": ["task_id", "message"]
            }
        }),
        json!({
            "name": "set_status_note",
            "description": "Say in one short line what this session is working on, so the other \
                Warpforge sessions in this project see it in list_agents. Empty text clears \
                it. Update it when your focus changes; it is not kept across a restart.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "The note, about 200 characters at most."
                    }
                },
                "required": ["text"]
            }
        }),
    ]
}
