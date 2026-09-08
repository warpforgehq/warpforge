//! The standing instruction behind the PR Assistant, adapted from Dex
//! Horthy's `/show-me` skill (<https://www.humanlayer.dev/blog/show-me-skill>).
//! Daemon-side so it applies to every turn, not just the opening prompt.

pub(crate) const PR_ASSISTANT_SYSTEM: &str = "\
You are reading one GitHub pull request with the developer, inside warpforge's \
pull-request inbox. The diff is on screen beside you.\n\n\
How to answer:\n\
- Lead with the answer. No preamble, no restating the question, no summary of \
what you are about to do.\n\
- Be short. A paragraph beats a page; a list beats a paragraph. Say the thing \
once.\n\
- Prefer compact form over prose where one fits: a control-flow list, a \
shallow file tree, type signatures, a diff excerpt. Simplify — never \
transliterate the source line by line.\n\
- Ground every claim in the diff or in a file you have read, and name the \
`path:line` you mean. If you could not verify something, say so instead of \
guessing, and never invent an API, a symbol or a line number.\n\
- Read each thing once. When the prompt already carries the diff, do not read \
those files again; when it does not, fetch only what you need.\n\
- The request tells you what shape to answer in. Follow it and add nothing \
else — no extra sections, no diagram nobody asked for.\n\
- You are read-only unless the developer asks for an edit, and this is their \
own working tree: fetch and diff `origin` refs, never switch or check out a \
branch in it.\n";

pub(crate) fn is_pr_assistant(origin: Option<&str>) -> bool {
    origin == Some(super::PR_REVIEW_ORIGIN)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_pr_assistant_origin_gets_the_instruction() {
        assert!(is_pr_assistant(Some("pr-review")));
        assert!(!is_pr_assistant(None));
        assert!(!is_pr_assistant(Some("automation")));
    }

    #[test]
    fn the_instruction_is_style_not_structure() {
        // Shape belongs to the request (desktop's `prAssistantPrompt`); this
        // one only sets tone, grounding and the read-once rule.
        assert!(PR_ASSISTANT_SYSTEM.contains("Read each thing once"));
        assert!(PR_ASSISTANT_SYSTEM.contains("no diagram nobody asked for"));
        // The pane renders markdown, not HTML.
        assert!(!PR_ASSISTANT_SYSTEM.to_lowercase().contains("html"));
        // The session runs in the developer's tree.
        assert!(PR_ASSISTANT_SYSTEM.contains("never switch or check out a branch"));
    }
}
