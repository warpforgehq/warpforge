use serde_json::{json, Value};

pub(super) fn defs() -> Vec<Value> {
    vec![
        json!({
        "name": "list_runtime",
             "description": "List the project's dev services and port-forwards with their \
                live status and allocated ports. Use this to discover what is running \
                (names, ports, URLs) before reading logs or restarting a service. Each \
                entry's logSeq is a log cursor you can pass as `after` to read_service_logs \
                / read_portforward_logs.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Optional project name. Defaults to the current project."
                    }
                }
            }
        }),
        json!({
        "name": "read_service_logs",
             "description": "Read a window of a dev service's retained stdout/stderr log \
                lines. Use to diagnose why a service failed, inspect request output, or \
                tail recent output. Fetch is non-destructive. Lines carry UTC timestamps \
                by default; filter runs over the whole buffer (grep | tail) and context \
                adds surrounding lines (grep -C). Poll new lines cheaply by passing the \
                previous response's nextSeq as `after`.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Optional project name. Defaults to the current project."
                    },
                    "service": {
                        "type": "string",
                        "description": "Service name as declared in .warpforge.yaml (see list_runtime)."
                    },
                    "after": {
                        "type": "integer",
                        "description": "Monotonic log cursor (a sequence number). Return lines with seq >= after (start from this cursor). Start with 0 to read from the oldest retained line, then pass the `nextSeq` from a previous response to cheaply poll for new lines. Stable even as the ring buffer drops old lines."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of lines to return (newest kept). Defaults to 100."
                    },
                    "filter": {
                        "type": "string",
                        "description": "Optional case-insensitive substring. Runs over the whole retained buffer, then the newest `limit` matching lines are kept (grep | tail)."
                    },
                    "context": {
                        "type": "integer",
                        "description": "Include N lines of surrounding context before and after each filter match (like grep -C). Ignored when no filter is given. Defaults to 0."
                    },
                    "timestamps": {
                        "type": "boolean",
                        "description": "Prepend a UTC timestamp to each line (like kubectl --timestamps). Defaults to true. Set false to return raw lines."
                    }
                },
                "required": ["service"]
            }
        }),
        json!({
            "name": "read_portforward_logs",
            "description": "Read a window of a port-forward's retained log lines.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Optional project name. Defaults to the current project."
                    },
                    "name": {
                        "type": "string",
                        "description": "Port-forward name as declared in .warpforge.yaml (see list_runtime)."
                    },
                    "after": {
                        "type": "integer",
                        "description": "Monotonic log cursor (a sequence number). Return lines with seq >= after (start from this cursor). Start with 0 to read from the oldest retained line, then pass the `nextSeq` from a previous response to cheaply poll for new lines. Stable even as the ring buffer drops old lines."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of lines to return (newest kept). Defaults to 100."
                    },
                    "filter": {
                        "type": "string",
                        "description": "Optional case-insensitive substring. Runs over the whole retained buffer, then the newest `limit` matching lines are kept (grep | tail)."
                    },
                    "context": {
                        "type": "integer",
                        "description": "Include N lines of surrounding context before and after each filter match (like grep -C). Ignored when no filter is given. Defaults to 0."
                    },
                    "timestamps": {
                        "type": "boolean",
                        "description": "Prepend a UTC timestamp to each line (like kubectl --timestamps). Defaults to true. Set false to return raw lines."
                    }
                },
                "required": ["name"]
            }
        }),
        json!({
            "name": "service_start",
            "description": "Start a dev service (async; returns immediately, the service \
                starts in the background). If it is already running this is a no-op. \
                Read its progress with read_service_logs.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Optional project name. Defaults to the current project."
                    },
                    "service": {
                        "type": "string",
                        "description": "Service name as declared in .warpforge.yaml."
                    }
                },
                "required": ["service"]
            }
        }),
        json!({
            "name": "service_stop",
            "description": "Stop a dev service (async; returns immediately).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Optional project name. Defaults to the current project."
                    },
                    "service": {
                        "type": "string",
                        "description": "Service name as declared in .warpforge.yaml."
                    }
                },
                "required": ["service"]
            }
        }),
        json!({
            "name": "service_restart",
            "description": "Restart a dev service (async; returns immediately). Use when \
                a service crashed or you changed its config and want a clean start. \
                Read its progress with read_service_logs.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Optional project name. Defaults to the current project."
                    },
                    "service": {
                        "type": "string",
                        "description": "Service name as declared in .warpforge.yaml."
                    }
                },
                "required": ["service"]
            }
        }),
        json!({
            "name": "portforward_start",
            "description": "Start a port-forward (async; returns immediately).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Optional project name. Defaults to the current project."
                    },
                    "name": {
                        "type": "string",
                        "description": "Port-forward name as declared in .warpforge.yaml."
                    }
                },
                "required": ["name"]
            }
        }),
        json!({
            "name": "portforward_stop",
            "description": "Stop a port-forward (async; returns immediately).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": {
                        "type": "string",
                        "description": "Optional project name. Defaults to the current project."
                    },
                    "name": {
                        "type": "string",
                        "description": "Port-forward name as declared in .warpforge.yaml."
                    }
                },
                "required": ["name"]
            }
        }),
    ]
}
