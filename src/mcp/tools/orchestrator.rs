use serde_json::{json, Value};

pub(super) fn defs() -> Value {
    json!([
        {
            "name": "spawn_agent",
            "description": "Dispatch a sub-agent to work on a task asynchronously. \
                Returns immediately with a task id; the sub-agent runs in its own \
                session and its result is delivered to your inbox when it finishes \
                — you will be prompted to call read_inbox. Spawn several in one turn \
                to run them in parallel.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "agent": {
                        "type": "string",
                        "description": "Which agent to run: e.g. claude, codex, opencode."
                    },
                    "task": {
                        "type": "string",
                        "description": "The full instruction/prompt for the sub-agent."
                    },
                    "model": {
                        "type": "string",
                        "description": "Optional model id for this agent session. When omitted, the agent's last-used model is reused. Use list_agent_models to discover valid ids."
                    }
                },
                "required": ["agent", "task"]
            }
        },
        {
            "name": "list_agent_models",
            "description": "List cached model options per configured+enabled agent. Without agent, returns compact index (id + model count); pass agent to get that agent's ids. Use before spawn_agent with model.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "agent": {
                        "type": "string",
                        "description": "Agent id to list models for. When omitted, returns compact per-agent counts."
                    }
                }
            }
        },
        {
            "name": "read_inbox",
            "description": "Collect finished sub-agent results delivered since you \
                last checked. Drains the inbox (each result is returned once).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "message_agent",
            "description": "Send a follow-up message to a previously spawned sub-agent, \
                continuing the same session. The agent sees the full conversation \
                history and can respond in context. Use this instead of spawn_agent \
                when you want to continue a conversation with an agent you already \
                started. Returns immediately; the agent's response will be delivered \
                to your inbox when it finishes — then call read_inbox.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "The task id returned by spawn_agent or a previous message_agent call."
                    },
                    "message": {
                        "type": "string",
                        "description": "The follow-up message / instruction to send to the agent."
                    }
                },
                "required": ["task_id", "message"]
            }
        },
        {
            "name": "list_agents",
            "description": "List sub-agent sessions spawned by this orchestrator. \
                The result is scoped to your current orchestrator task, and can \
                optionally be narrowed to a project.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Optional project name. Defaults to the orchestrator's project."
                    }
                }
            }
        },
        {
            "name": "stop_agent",
            "description": "Hard-stop one sub-agent session owned by this orchestrator. \
                The task remains in history so its result and context are not lost.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "Task id returned by spawn_agent or list_agents."
                    }
                },
                "required": ["task_id"]
            }
        },
        {
            "name": "cleanup_agents",
            "description": "Permanently remove child agent sessions owned by this \
                orchestrator. By default all waiting, done, blocked, and \
                interrupted tasks are selected: each is hard-stopped first, then its \
                task record and session history are deleted. Running and queued \
                sessions are skipped unless include_active=true. Returns a JSON report.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "max_age_seconds": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "Optional minimum age since last update; defaults to 0 (all eligible children)."
                    },
                    "dry_run": {
                        "type": "boolean",
                        "description": "When true, report candidates without stopping or deleting them. Defaults to false."
                    },
                    "include_active": {
                        "type": "boolean",
                        "description": "Also allow running/queued sessions to be stopped and deleted. Defaults to false."
                    },
                    "project": {
                        "type": "string",
                        "description": "Optional project name; must match the orchestrator project."
                    }
                }
            }
        },
        {
            "name": "spawn_workflow",
            "description": "Dispatch a deterministic multi-stage pipeline (plan → implement → \
                review ⇄ fix) as a child of this orchestrator, instead of a single sub-agent. \
                Use this for changes that benefit from an independent review pass; for \
                straightforward tasks prefer spawn_agent — a pipeline costs several times the \
                tokens and wall-clock. Returns immediately with a task id; the pipeline's final \
                outcome is delivered to your inbox like a sub-agent's, and its live progress \
                (current stage, review round, whether it is waiting on you) shows up in \
                list_agents under workflowRun. It has no agent session of its own — do not use \
                message_agent on it; use answer_workflow / decide_workflow instead.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "Id of a workflow template available to the project (see the project's .warpforge/workflows/ or ask the user which pipelines exist)."
                    },
                    "goal": {
                        "type": "string",
                        "description": "The objective for the pipeline's first stage — what should be planned/implemented."
                    },
                    "agent": {
                        "type": "string",
                        "description": "Default agent for the pipeline's stages: e.g. \"claude\", \"codex\", \"opencode\"."
                    }
                },
                "required": ["workflow_id", "goal", "agent"]
            }
        },
        {
            "name": "pause_workflow",
            "description": "Soft-pause a workflow pipeline owned by this orchestrator. The \
                running stage finishes its current turn; the next stage does not start until \
                resume_workflow is called.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "Task id returned by spawn_workflow or list_agents."
                    }
                },
                "required": ["task_id"]
            }
        },
        {
            "name": "resume_workflow",
            "description": "Resume a paused workflow pipeline owned by this orchestrator.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "Task id returned by spawn_workflow or list_agents."
                    },
                    "note": {
                        "type": "string",
                        "description": "Optional guidance delivered to the next stage as extra context."
                    }
                },
                "required": ["task_id"]
            }
        },
        {
            "name": "answer_workflow",
            "description": "Answer a workflow pipeline stage's pending question. Only valid \
                while the pipeline is waiting on a question (list_agents shows \
                workflowRun.waiting.kind == \"question\"). The message is forwarded to the \
                stage session that asked.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "Task id returned by spawn_workflow or list_agents."
                    },
                    "message": {
                        "type": "string",
                        "description": "The answer to the stage's question."
                    }
                },
                "required": ["task_id", "message"]
            }
        },
        {
            "name": "decide_workflow",
            "description": "Decide what a workflow pipeline does once it has exhausted its \
                review ⇄ fix rounds with open findings (list_agents shows \
                workflowRun.waiting.kind == \"limit\").",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "task_id": {
                        "type": "string",
                        "description": "Task id returned by spawn_workflow or list_agents."
                    },
                    "decision": {
                        "type": "string",
                        "enum": ["extend", "finish", "stop"],
                        "description": "extend: grant more review rounds and continue. finish: accept the pipeline's work as-is with the open findings noted. stop: stop the pipeline."
                    },
                    "rounds": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 5,
                        "description": "For decision=extend: how many extra review rounds to grant. Defaults to 1."
                    },
                    "note": {
                        "type": "string",
                        "description": "For decision=extend: optional guidance delivered to the next fix stage."
                    }
                },
                "required": ["task_id", "decision"]
            }
        }
    ])
}
