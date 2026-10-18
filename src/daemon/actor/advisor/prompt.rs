//! What the executor and the advisor are told, and the bounded digest of the
//! executor's transcript each question carries.

use warpforge_protocol as wire;

/// Added to the executor's opening prompt when its task has an advisor.
pub(crate) const EXECUTOR_NUDGE: &str = "\
This task has an advisor: a second agent, with a read-only view of this \
checkout, that you can consult with the ask_advisor(question, context?) tool. \
It already sees the task's goal, recent messages and changed files, so ask the \
question itself. Consult it before a big design decision, when you are stuck \
after a couple of failed attempts, and once before you declare the task done. \
It is advice, not orders: weigh it against what you know. Each question costs \
time and tokens, and a turn allows at most three.";

/// Opens the advisor's session, ahead of the first question.
const ADVISOR_SYSTEM: &str = "\
You are the advisor on a coding task in Warpforge. Another agent, the \
executor, is doing the work in this checkout and consults you with questions. \
You only advise: never edit, create or delete files, never run commands that \
change anything, never commit. Your write tools are denied. Read the code, run \
read-only commands (git diff, git log, grep) and think.\n\n\
Answer the executor's question directly in your reply: lead with the \
recommendation, then the reasons, then any risk it has missed. Be concrete — \
name files, functions and line numbers — and short enough to act on. If the \
question rests on a wrong premise, say so. You keep this conversation across \
questions, so later questions build on your earlier advice. Do not present a \
plan for approval: your reply is the answer.";

const USER_MESSAGES: usize = 3;
const USER_MESSAGE_CHARS: usize = 800;
const EXECUTOR_MESSAGES: usize = 4;
const EXECUTOR_MESSAGE_CHARS: usize = 1_200;
const GOAL_CHARS: usize = 4_000;
const CONTEXT_CHARS: usize = 4_000;
const FILE_LINES: usize = 40;

/// Everything a question hands the advisor besides the question.
pub(crate) struct Digest {
    pub(crate) user_messages: Vec<String>,
    pub(crate) executor_messages: Vec<String>,
    /// `git status --short` of the checkout, bounded.
    pub(crate) changed_files: String,
}

/// Summarise the executor's transcript since its last consultation.
/// @param updates the executor's whole persisted transcript, oldest first
/// @param status the checkout's `git status --short` output
/// @returns the bounded digest
pub(crate) fn digest(updates: &[wire::SessionUpdate], status: &str) -> Digest {
    let since = updates
        .iter()
        .rposition(|update| matches!(update, wire::SessionUpdate::AdvisorConsultation { .. }))
        .map_or(0, |index| index + 1);
    let mut user_messages = Vec::new();
    let mut executor_messages: Vec<String> = Vec::new();
    let mut speaking = false;
    for update in &updates[since..] {
        match update {
            wire::SessionUpdate::UserMessage { text, .. } => {
                user_messages.push(text.clone());
                speaking = false;
            }
            wire::SessionUpdate::AgentText { text } => {
                match executor_messages.last_mut().filter(|_| speaking) {
                    Some(last) => last.push_str(text),
                    None => executor_messages.push(text.clone()),
                }
                speaking = true;
            }
            wire::SessionUpdate::Usage { .. } | wire::SessionUpdate::AvailableCommands { .. } => {}
            _ => speaking = false,
        }
    }
    Digest {
        user_messages: last_clipped(user_messages, USER_MESSAGES, USER_MESSAGE_CHARS),
        executor_messages: last_clipped(
            executor_messages,
            EXECUTOR_MESSAGES,
            EXECUTOR_MESSAGE_CHARS,
        ),
        changed_files: first_lines(status, FILE_LINES),
    }
}

/// The prompt for one consultation.
/// @param goal the task's title and opening prompt, on the first question only
/// @param digest what happened since the last consultation
/// @param question the executor's question
/// @param context what the executor attached to it
/// @returns the text the advisor is sent
pub(crate) fn consultation_prompt(
    goal: Option<(&str, &str)>,
    digest: &Digest,
    question: &str,
    context: Option<&str>,
) -> String {
    let mut out = String::new();
    if let Some((title, prompt)) = goal {
        out.push_str(ADVISOR_SYSTEM);
        out.push_str("\n\n## The task\n");
        if !title.trim().is_empty() {
            out.push_str(&format!("Title: {}\n", title.trim()));
        }
        out.push_str(&format!(
            "The user's request:\n{}\n\n",
            clip(prompt.trim(), GOAL_CHARS)
        ));
        out.push_str("## What has happened so far\n");
    } else {
        out.push_str("## What has happened since the last question\n");
    }
    section(&mut out, "The user said", &digest.user_messages);
    section(&mut out, "The executor said", &digest.executor_messages);
    let files = digest.changed_files.trim();
    if files.is_empty() {
        out.push_str("No files are changed in the checkout yet.\n\n");
    } else {
        out.push_str(&format!(
            "Changed files (`git status --short`; run `git diff` to read them):\n{files}\n\n"
        ));
    }
    out.push_str(&format!("## The executor asks\n{}\n", question.trim()));
    if let Some(context) = context.map(str::trim).filter(|c| !c.is_empty()) {
        out.push_str(&format!(
            "\nContext from the executor:\n{}\n",
            clip(context, CONTEXT_CHARS)
        ));
    }
    out
}

/// The session-mode value that makes the advisor's harness read-only, when
/// the agent advertises one: Codex `read-only`, Claude Code `plan`.
/// @param options the selectors the agent reported
/// @returns the config id and value to set, if any fits
pub(crate) fn read_only_mode(options: &[wire::ConfigOption]) -> Option<(String, String)> {
    const READ_ONLY: [&str; 4] = ["read-only", "read_only", "readonly", "plan"];
    let mode = options
        .iter()
        .find(|o| o.category.as_deref() == Some("mode") || o.id == "mode")?;
    READ_ONLY.iter().find_map(|wanted| {
        mode.options
            .iter()
            .find(|choice| choice.value.eq_ignore_ascii_case(wanted))
            .map(|choice| (mode.id.clone(), choice.value.clone()))
    })
}

/// The session mode a Smith's thread runs in. A plan mode is never picked:
/// its harness prompt makes the model refuse `start_work` and the board tools.
/// Codex `read-only` keeps its shell sandboxed; Claude `default` asks before
/// every edit and command, which the daemon denies; opencode runs `build` with
/// asking permissions (`smiths::permissions::thread_env`).
/// @param options the selectors the agent reported
/// @returns the config id and value to set, if any fits
pub(crate) fn thread_mode(options: &[wire::ConfigOption]) -> Option<(String, String)> {
    const THREAD: [&str; 5] = ["read-only", "read_only", "readonly", "default", "build"];
    let mode = options
        .iter()
        .find(|o| o.category.as_deref() == Some("mode") || o.id == "mode")?;
    THREAD.iter().find_map(|wanted| {
        mode.options
            .iter()
            .find(|choice| choice.value.eq_ignore_ascii_case(wanted))
            .map(|choice| (mode.id.clone(), choice.value.clone()))
    })
}

fn section(out: &mut String, heading: &str, items: &[String]) {
    if items.is_empty() {
        return;
    }
    out.push_str(&format!("{heading}:\n"));
    for item in items {
        out.push_str(&format!("> {}\n\n", item.trim().replace('\n', "\n> ")));
    }
}

fn last_clipped(items: Vec<String>, keep: usize, chars: usize) -> Vec<String> {
    let skip = items.len().saturating_sub(keep);
    items
        .into_iter()
        .skip(skip)
        .filter(|item| !item.trim().is_empty())
        .map(|item| clip(item.trim(), chars))
        .collect()
}

fn first_lines(text: &str, lines: usize) -> String {
    let total = text.lines().count();
    let mut out: Vec<&str> = text.lines().take(lines).collect();
    let more = total.saturating_sub(lines);
    let tail = format!("… and {more} more");
    if more > 0 {
        out.push(&tail);
    }
    out.join("\n")
}

/// Keep the end of a long message: an agent's conclusion is at its end.
fn clip(text: &str, chars: usize) -> String {
    let count = text.chars().count();
    if count <= chars {
        return text.to_string();
    }
    let tail: String = text.chars().skip(count - chars).collect();
    format!("…{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(text: &str) -> wire::SessionUpdate {
        wire::SessionUpdate::UserMessage {
            text: text.into(),
            attachments: vec![],
        }
    }

    fn said(text: &str) -> wire::SessionUpdate {
        wire::SessionUpdate::AgentText { text: text.into() }
    }

    fn tool() -> wire::SessionUpdate {
        wire::SessionUpdate::ToolCall {
            tool_call_id: "t".into(),
            title: "Read".into(),
            status: wire::ToolCallStatus::Completed,
            started_at: None,
            tool_kind: "read".into(),
            content: None,
        }
    }

    fn consulted() -> wire::SessionUpdate {
        wire::SessionUpdate::AdvisorConsultation {
            question: "q".into(),
            answer: "a".into(),
            outcome: wire::AdvisorOutcome::Answered,
            agent: "codex".into(),
            model: None,
            advisor_task_id: "t_adv".into(),
            cost: None,
        }
    }

    #[test]
    fn the_digest_covers_only_what_happened_since_the_last_question() {
        let updates = vec![
            user("build the parser"),
            said("Reading "),
            said("the grammar."),
            consulted(),
            user("also handle comments"),
            said("Looking at the lexer."),
            tool(),
            said("Comments now "),
            said("skip to end of line."),
        ];
        let digest = digest(&updates, " M src/lexer.rs\n");
        assert_eq!(digest.user_messages, ["also handle comments"]);
        assert_eq!(
            digest.executor_messages,
            ["Looking at the lexer.", "Comments now skip to end of line."]
        );
        assert_eq!(digest.changed_files, " M src/lexer.rs");
    }

    #[test]
    fn the_digest_is_bounded() {
        let long = "x".repeat(10_000);
        let mut updates = Vec::new();
        for _ in 0..20 {
            updates.push(user(&long));
            updates.push(said(&long));
        }
        let status: String = (0..100).map(|i| format!(" M f{i}.rs\n")).collect();
        let digest = digest(&updates, &status);
        let prompt = consultation_prompt(Some(("T", &long)), &digest, "q?", Some(&long));
        assert_eq!(digest.user_messages.len(), USER_MESSAGES);
        assert_eq!(digest.executor_messages.len(), EXECUTOR_MESSAGES);
        assert!(digest.changed_files.ends_with("… and 60 more"));
        assert!(prompt.len() < 20_000, "prompt is {} bytes", prompt.len());
    }

    #[test]
    fn only_the_first_question_carries_the_goal_and_the_role() {
        let empty = digest(&[], "");
        let first = consultation_prompt(Some(("Parser", "build it")), &empty, "which crate?", None);
        assert!(first.contains("You only advise"));
        assert!(first.contains("build it"));
        assert!(first.ends_with("which crate?\n"));
        let later = consultation_prompt(None, &empty, "and now?", Some("tried nom"));
        assert!(!later.contains("You only advise"));
        assert!(later.contains("since the last question"));
        assert!(later.contains("tried nom"));
    }

    fn mode(values: &[&str]) -> wire::ConfigOption {
        wire::ConfigOption {
            id: "mode".into(),
            name: "Mode".into(),
            category: Some("mode".into()),
            current_value: values[0].into(),
            options: values
                .iter()
                .map(|v| wire::ConfigChoice {
                    value: (*v).into(),
                    name: (*v).into(),
                })
                .collect(),
        }
    }

    #[test]
    fn a_read_only_mode_is_picked_from_what_the_agent_advertises() {
        let codex = [mode(&["auto", "read-only", "full-access"])];
        assert_eq!(
            read_only_mode(&codex),
            Some(("mode".into(), "read-only".into()))
        );
        let claude = [mode(&["default", "acceptEdits", "plan"])];
        assert_eq!(read_only_mode(&claude).unwrap().1, "plan");
        assert_eq!(read_only_mode(&[mode(&["build", "yolo"])]), None);
        assert_eq!(read_only_mode(&[]), None);
    }

    #[test]
    fn a_thread_never_runs_in_a_plan_mode() {
        let codex = [mode(&["auto", "read-only", "full-access"])];
        assert_eq!(thread_mode(&codex).unwrap().1, "read-only");
        let claude = [mode(&["default", "acceptEdits", "plan", "auto"])];
        assert_eq!(thread_mode(&claude).unwrap().1, "default");
        let opencode = [mode(&["build", "plan"])];
        assert_eq!(thread_mode(&opencode).unwrap().1, "build");
        assert_eq!(thread_mode(&[mode(&["plan"])]), None);
    }
}
