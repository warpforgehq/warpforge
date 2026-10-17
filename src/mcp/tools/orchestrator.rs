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
            "description": "Start a Factory pipeline (plan? → implement → verify? → review ⇄ \
                fix, from a workflow template) for any goal, instead of a single sub-agent. \
                Use it for changes that benefit from an independent review pass; for \
                straightforward tasks prefer spawn_agent — a pipeline costs several times the \
                tokens and wall-clock. Without pull_request (the default) it is your child: it \
                starts at once, commits nothing, its outcome is delivered to your inbox like a \
                sub-agent's, its live progress (stage, review round, whether it waits on you) \
                shows in list_agents under workflowRun, and you answer it with answer_workflow / \
                decide_workflow (never message_agent: it has no session of its own). Set \
                pull_request to true when the change should ship: the task then goes through the \
                Factory like one started from New Task — it waits for the project's Factory \
                limits, a successful run is committed, pushed and opened as a draft pull request \
                for a person to review, and merging it marks a linked backlog item done. Such a \
                task is not your child and reports nothing to your inbox; follow it with \
                runner_status. To start several backlog items at once with one configuration, \
                use runner_enqueue instead.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "workflow_id": {
                        "type": "string",
                        "description": "Id of a workflow template available to the project (see the project's .warpforge/workflows/ or ask the user which pipelines exist)."
                    },
                    "goal": {
                        "type": "string",
                        "description": "What the pipeline should implement. May be omitted when backlog_item is given: the item's brief is used."
                    },
                    "agent": {
                        "type": "string",
                        "description": "Lead agent: every stage the template does not pin runs on it, e.g. \"claude\", \"codex\", \"opencode\"."
                    },
                    "model": {
                        "type": "string",
                        "description": "Lead model; it must be one of the lead agent's models (see list_agent_models). Stages on other agents use their own default. When omitted, the agent's own default is used."
                    },
                    "pull_request": {
                        "type": "boolean",
                        "description": "Open a draft pull request when the run succeeds, through the Factory queue. Defaults to false."
                    },
                    "run_location": {
                        "type": "string",
                        "enum": ["auto", "worktree", "checkout"],
                        "description": "Where it runs: 'worktree' (a background copy of the repository), 'checkout' (the project folder, so a browser check tests the running app), or 'auto' (the project's Factory setting; by default the project folder for a template that tests the app, a background copy otherwise). Defaults to 'auto' with pull_request, and to 'checkout' (your own checkout, as before) without."
                    },
                    "backlog_item": {
                        "type": "integer",
                        "description": "Backlog item number, as in #87, to link the task to. With pull_request, merging the pull request marks it done."
                    }
                },
                "required": ["workflow_id", "agent"]
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
                    },
                    "barrier_id": {
                        "type": "string",
                        "description": "The workflowRun.waiting.barrierId from list_agents. Pass the id you saw so a stale answer is refused rather than landing on a newer question."
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
                    },
                    "barrier_id": {
                        "type": "string",
                        "description": "The workflowRun.waiting.barrierId from list_agents. Pass the id you saw so a stale decision is refused rather than landing on a newer barrier."
                    }
                },
                "required": ["task_id", "decision"]
            }
        }
    ])
}
