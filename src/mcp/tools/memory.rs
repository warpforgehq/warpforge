use serde_json::{json, Value};

pub(super) fn defs() -> Vec<Value> {
    vec![
        json!({
            "name": "memory_store",
            "description": "Persist a durable fact to Warpforge shared memory (visible to all harnesses). \
                Prefer over CLAUDE.md/AGENTS.md for cross-session knowledge.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "content": {
                        "type": "string",
                        "description": "The fact/decision/preference/gotcha to remember."
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["global", "project"],
                        "description": "global (all projects) or project (this project). Defaults to project when project_id is set, else global."
                    },
                    "kind": {
                        "type": "string",
                        "enum": ["fact", "decision", "preference", "gotcha", "note"],
                        "description": "Kind of memory. Defaults to note."
                    },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional tags for filtering."
                    },
                    "project_id": {
                        "type": "string",
                        "description": "Project id for project scope. Defaults to the current project."
                    }
                },
                "required": ["content"]
            }
        }),
        json!({
            "name": "memory_search",
            "description": "Search Warpforge shared memory (full-text, relevance-ranked). Returns matching \
                memories with highlighted snippets.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Search terms."
                    },
                    "scope": {
                        "type": "string",
                        "enum": ["all", "global", "project"],
                        "description": "Which scope to search. Defaults to all enabled scopes."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 10, max 100)."
                    },
                    "mode": {
                        "type": "string",
                        "enum": ["fts", "hybrid"],
                        "description": "fts only in v1; hybrid behaves the same."
                    }
                },
                "required": ["query"]
            }
        }),
        json!({
            "name": "memory_list",
            "description": "List stored memories (most recently updated first), optionally filtered by scope and kind.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scope": {
                        "type": "string",
                        "enum": ["all", "global", "project"],
                        "description": "Which scope to list. Defaults to all enabled scopes."
                    },
                    "kind": {
                        "type": "string",
                        "enum": ["fact", "decision", "preference", "gotcha", "note"],
                        "description": "Filter to one kind."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Max results (default 100)."
                    },
                    "offset": {
                        "type": "integer",
                        "description": "Skip this many results (default 0)."
                    }
                }
            }
        }),
        json!({
            "name": "memory_update",
            "description": "Rewrite an existing memory's content (by id, returned from memory_search/memory_list).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Memory id." },
                    "content": { "type": "string", "description": "New content." }
                },
                "required": ["id", "content"]
            }
        }),
        json!({
            "name": "memory_delete",
            "description": "Permanently delete a memory (by id). Explicit user/agent action; nothing is auto-deleted.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Memory id." }
                },
                "required": ["id"]
            }
        }),
        json!({
            "name": "memory_stats",
            "description": "Report memory counts and which scopes are active, so you can adapt your prompts.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "memory_dream",
            "description": "Run memory dreaming compaction pass: find duplicates, contradictions, stale facts; propose superseded_by/merge/delete. dry_run true lists without writing.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "dry_run": { "type": "boolean", "description": "When true, just list proposals without writing to compaction log." }
                }
            }
        }),
        json!({
            "name": "memory_list_compaction",
            "description": "List pending compaction proposals (id, type, target_ids, reason, status).",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "memory_resolve_compaction",
            "description": "Resolve a compaction proposal: approve (applied) or reject. Use after verifying against code.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "integer", "description": "Proposal id from memory_list_compaction." },
                    "approve": { "type": "boolean", "description": "True=applied, false=rejected. Default true." }
                },
                "required": ["id"]
            }
        }),
        json!({
            "name": "memory_addEdge",
            "description": "Add a directed edge between two memories.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "src_id": { "type": "string", "description": "Source memory id." },
                    "dst_id": { "type": "string", "description": "Destination memory id." },
                    "relation": { "type": "string", "description": "Relation label." }
                },
                "required": ["src_id", "dst_id", "relation"]
            }
        }),
        json!({
            "name": "memory_edges",
            "description": "List edges for a memory.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string", "description": "Memory id." }
                },
                "required": ["id"]
            }
        }),
    ]
}
