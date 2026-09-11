use std::collections::HashMap;

use crate::workflow_config::{render_template, ReviewContextItem, WorkflowSpec};

// ─── Prompt building ─────────────────────────────────────────────────────────

/// Everything a stage prompt can draw on. Owned strings so the actor can
/// assemble it without borrow gymnastics.
#[derive(Debug, Default, Clone)]
pub struct PromptCtx {
    pub task_prompt: String,
    pub plan: Option<String>,
    pub implementer_summary: Option<String>,
    pub diff: Option<String>,
    /// Pre-formatted findings list (fix stage).
    pub findings: Option<String>,
    /// Previous round's findings (repeat review rounds) — the reviewer must
    /// verify each one instead of reviewing from scratch.
    pub prior_findings: Option<String>,
    pub round: u32,
    pub max_rounds: u32,
    pub guidance: Option<String>,
}

/// Appended to every plan/implement/fix prompt — the question protocol the
/// engine's `parse_stage_signal` understands.
const QUESTION_PROTOCOL: &str = "This stage runs unattended, so stop for the user only when you \
genuinely cannot proceed — a decision only they can make, or missing access. Otherwise pick the \
most reasonable option, proceed, and record the assumption in your final message. When you do \
need them, end your reply with exactly one fenced code block of this shape and stop:\n\
```json\n{\"need_user_input\": \"<your question>\"}\n```\n\
Otherwise, do not emit such a block.";

/// Appended to every reviewer prompt — the verdict protocol the engine's
/// `parse_review_verdict` understands.
const VERDICT_PROTOCOL: &str = "Scope: judge correctness, regressions, and whether the task's \
stated requirements are met. Style, naming, and improvements nobody asked for are `low` at most. \
Report real problems only — do not invent findings to seem thorough. You may run read-only \
verification (build, tests, linters) to check your reasoning, but do not edit files.\n\n\
You MUST end your reply with exactly one fenced code block, and nothing after it, of this \
shape:\n\
```json\n{\"verdict\": \"request_changes\", \"findings\": [{\"severity\": \"high\", \"file\": \"src/example.rs\", \"line\": 42, \"snippet\": \"if attempts > max {\", \"description\": \"what is wrong and why\"}]}\n```\n\
Anchor every finding you can: `line` is the line in the file AFTER the change \
(each diff hunk header `@@ -old +new @@` gives you the new-file line its body \
starts at), and `snippet` is one short verbatim line of the offending code. \
Both are optional but they let the repair stage go straight to the right place \
instead of searching.\n\
When you approve, send `{\"verdict\": \"approve\", \"findings\": []}` — use `approve` only when no \
critical, high, or medium problem remains. `findings` MUST be a JSON array (empty when there are \
none) and every entry MUST carry a `description`: anything you only write in prose is invisible \
to the pipeline. `severity` is critical, high, medium, or low, and `file` may be null. Note that \
`low` findings are recorded for the human but are NEVER sent to the repair stage — use `medium` \
or higher for anything you actually want fixed.";

fn vars_from_ctx(ctx: &PromptCtx, focus: Option<&str>) -> HashMap<&'static str, String> {
    let mut vars: HashMap<&'static str, String> = HashMap::new();
    vars.insert("task_prompt", ctx.task_prompt.clone());
    vars.insert("plan", ctx.plan.clone().unwrap_or_default());
    vars.insert(
        "implementer_summary",
        ctx.implementer_summary.clone().unwrap_or_default(),
    );
    vars.insert("diff", ctx.diff.clone().unwrap_or_default());
    vars.insert("findings", ctx.findings.clone().unwrap_or_default());
    vars.insert("round", ctx.round.to_string());
    vars.insert("max_rounds", ctx.max_rounds.to_string());
    vars.insert("focus", focus.unwrap_or_default().to_string());
    vars
}

fn push_section(out: &mut String, title: &str, body: &str) {
    if body.trim().is_empty() {
        return;
    }
    out.push_str("## ");
    out.push_str(title);
    out.push('\n');
    out.push_str(body.trim_end());
    out.push_str("\n\n");
}

fn finish_prompt(mut body: String, protocol: &str, guidance: Option<&str>) -> String {
    if let Some(guidance) = guidance {
        if !guidance.trim().is_empty() {
            push_section(&mut body, "User guidance", guidance);
        }
    }
    let body = body.trim_end();
    format!("{body}\n\n---\n{protocol}")
}

pub fn build_plan_prompt(spec: &WorkflowSpec, ctx: &PromptCtx) -> String {
    let body = match spec.plan.as_ref().and_then(|s| s.prompt.as_deref()) {
        Some(custom) => render_template(custom, &vars_from_ctx(ctx, None)),
        None => {
            let mut out = String::from(
                "You are the planning stage of a workflow pipeline. Explore the codebase as \
                 needed and produce a concise implementation plan: the files to touch, the \
                 approach, edge cases, and how to verify the result. Do NOT edit any files — \
                 this stage is planning only. Your final message is handed to the implementer \
                 verbatim, so end with the complete plan.\n\n",
            );
            push_section(&mut out, "Task", &ctx.task_prompt);
            out
        }
    };
    finish_prompt(body, QUESTION_PROTOCOL, ctx.guidance.as_deref())
}

pub fn build_implement_prompt(spec: &WorkflowSpec, ctx: &PromptCtx) -> String {
    let body = match spec.implement.prompt.as_deref() {
        Some(custom) => render_template(custom, &vars_from_ctx(ctx, None)),
        None => {
            let mut out = String::from(
                "You are the implementation stage of a workflow pipeline. Implement the task \
                 below completely: write the code, keep the change focused, and verify your \
                 work (build/tests) where feasible. Your final message should summarize what \
                 you did — it is handed to the reviewers.\n\n",
            );
            push_section(&mut out, "Task", &ctx.task_prompt);
            if let Some(plan) = ctx.plan.as_deref() {
                push_section(&mut out, "Approved plan", plan);
            }
            out
        }
    };
    finish_prompt(body, QUESTION_PROTOCOL, ctx.guidance.as_deref())
}

pub fn build_reviewer_prompt(spec: &WorkflowSpec, reviewer: usize, ctx: &PromptCtx) -> String {
    let config = &spec.review.reviewers[reviewer];
    let focus = config.focus.as_deref();
    let body = match config.prompt.as_deref() {
        Some(custom) => render_template(custom, &vars_from_ctx(ctx, focus)),
        None => {
            let mut out = format!(
                "You are a code reviewer in a workflow pipeline (round {}/{}). Review the \
                 changes below against the task. Do NOT edit any files — review only. Judge \
                 what is actually there: verify claims against the diff, and flag real \
                 problems with concrete evidence.\n\n",
                ctx.round, ctx.max_rounds
            );
            if let Some(focus) = focus {
                push_section(&mut out, "Your focus", focus);
            }
            for item in &spec.review.context {
                match item {
                    ReviewContextItem::Prompt => push_section(&mut out, "Task", &ctx.task_prompt),
                    ReviewContextItem::Plan => {
                        if let Some(plan) = ctx.plan.as_deref() {
                            push_section(&mut out, "Approved plan", plan);
                        }
                    }
                    ReviewContextItem::ImplementerSummary => {
                        if let Some(summary) = ctx.implementer_summary.as_deref() {
                            push_section(&mut out, "Implementer's summary", summary);
                        }
                    }
                    ReviewContextItem::Diff => {
                        if let Some(diff) = ctx.diff.as_deref() {
                            push_section(&mut out, "Working-copy diff", diff);
                        }
                    }
                }
            }
            out
        }
    };
    let mut body = body;
    if let Some(prior) = ctx.prior_findings.as_deref() {
        if !body.ends_with('\n') {
            body.push('\n');
        }
        body.push('\n');
        push_section(
            &mut body,
            "Previous round's findings — verify each one",
            &format!(
                "{prior}\n\nThis is a repeat review after a repair pass. For every finding \
                 above, state whether it is actually resolved in the current diff — do not take \
                 the fixer's summary on faith; reopen anything that is not. Then check the rest \
                 of the changes for regressions the repair may have introduced, including code \
                 that was fine last round."
            ),
        );
    }
    // Reviewers get no guidance block — guidance targets implement/fix.
    finish_prompt(body, VERDICT_PROTOCOL, None)
}

/// Follow-up message sent into a reviewer's EXISTING session for a repeat
/// round (`review.reask: same_session`). The session already holds the task,
/// the original diff, and this reviewer's own reasoning, so the follow-up
/// carries only what changed since — plus the explicit anti-anchoring
/// instructions: verify every prior finding and re-check for regressions.
pub fn build_rereview_prompt(ctx: &PromptCtx) -> String {
    let mut out = format!(
        "The repair stage has addressed your review. This is review round {}/{}.\n\n",
        ctx.round, ctx.max_rounds
    );
    if let Some(summary) = ctx.implementer_summary.as_deref() {
        push_section(&mut out, "Fixer's summary", summary);
    }
    if let Some(findings) = ctx.prior_findings.as_deref() {
        push_section(
            &mut out,
            "Findings raised last round (all reviewers)",
            findings,
        );
    }
    if let Some(diff) = ctx.diff.as_deref() {
        push_section(&mut out, "Current working-copy diff", diff);
    }
    push_section(
        &mut out,
        "What to do",
        "Go through each finding above and verify against the current diff that it is actually \
         resolved — do not take the fixer's summary on faith; reopen anything that is not. Then \
         check the changes for regressions the repair may have introduced, including code you \
         found fine last round. Defending your earlier verdict is not a goal — accuracy is.",
    );
    finish_prompt(out, VERDICT_PROTOCOL, None)
}

pub fn build_fix_prompt(spec: &WorkflowSpec, ctx: &PromptCtx) -> String {
    let body = match spec.fix.prompt.as_deref() {
        Some(custom) => render_template(custom, &vars_from_ctx(ctx, None)),
        None => {
            let mut out = format!(
                "You are the repair stage of a workflow pipeline (round {}/{}). Reviewers \
                 found the problems listed below. Address every finding — fix it or, when a \
                 finding is factually wrong, explain why in your summary. Do not change \
                 unrelated code. Your final message should summarize what you changed; it is \
                 handed back to the reviewers.\n\n",
                ctx.round, ctx.max_rounds
            );
            push_section(&mut out, "Task", &ctx.task_prompt);
            if let Some(findings) = ctx.findings.as_deref() {
                push_section(&mut out, "Findings to address", findings);
            }
            if let Some(diff) = ctx.diff.as_deref() {
                push_section(&mut out, "Current working-copy diff", diff);
            }
            out
        }
    };
    finish_prompt(body, QUESTION_PROTOCOL, ctx.guidance.as_deref())
}

/// Follow-up sent to a reviewer whose output had no parseable verdict.
pub fn reask_verdict_prompt(reason: &str) -> String {
    format!(
        "Your previous reply could not be parsed: {reason}. Reply with ONLY the fenced JSON \
         verdict block:\n```json\n{{\"verdict\": \"approve\" | \"request_changes\", \
         \"findings\": [{{\"severity\": \"…\", \"file\": \"…\", \"description\": \"…\"}}]}}\n```"
    )
}
