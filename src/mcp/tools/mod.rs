use serde_json::Value;

use super::automations;

mod backlog;
mod memory;
mod orchestrator;
mod runtime;

pub(crate) fn tool_defs(is_orchestrator: bool) -> Value {
    let mut tools: Vec<Value> = Vec::new();
    tools.extend(runtime::defs());
    tools.extend(backlog::defs());
    tools.extend(memory::defs());

    if is_orchestrator {
        if let Value::Array(orch) = orchestrator::defs() {
            tools.extend(orch);
        }
    }
    if let Value::Array(automation) = automations::tool_defs() {
        tools.extend(automation);
    }
    Value::Array(tools)
}
