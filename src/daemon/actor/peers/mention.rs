//! @mentions in channel posts (ADR 0026 addendum): resolving them against the
//! project's visible peers, and routing an agent's mentions as direct
//! messages. A user's mentions are `User` prompts (`user.rs`).

use warpforge_protocol as wire;

use crate::daemon::actor::Daemon;
use crate::daemon::task::now_secs;

/// Shortest task-id prefix a mention may use.
const MIN_ID_PREFIX: usize = 4;

/// A session a mention can name.
pub(crate) struct Candidate {
    pub id: String,
    pub label: String,
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// How many chars of `rest` spell `label`, case-insensitive, ending at a word
/// boundary.
fn label_match(rest: &str, label: &str) -> Option<usize> {
    let len = label.chars().count();
    if len == 0 {
        return None;
    }
    let mut chars = rest.chars();
    for expected in label.chars() {
        let actual = chars.next()?;
        if !actual.to_lowercase().eq(expected.to_lowercase()) {
            return None;
        }
    }
    match chars.next() {
        Some(next) if is_word(next) => None,
        _ => Some(len),
    }
}

/// How many chars of `rest` name `id`: the whole id, or a prefix of at least
/// four chars of its hex part, with or without `t_`.
fn id_match(rest: &str, id: &str) -> Option<usize> {
    let token: String = rest.chars().take_while(|c| is_word(*c)).collect();
    let lower = token.to_lowercase();
    let hex = id.strip_prefix("t_").unwrap_or(id);
    let prefix = lower.strip_prefix("t_").unwrap_or(&lower);
    (prefix.chars().count() >= MIN_ID_PREFIX && hex.starts_with(prefix))
        .then(|| token.chars().count())
}

/// The sessions `text` @mentions, in order of first mention.
/// @param text the post
/// @param candidates the sessions a mention may name
/// @returns their ids, or an error listing the candidates of an ambiguous one
pub(crate) fn resolve_mentions(
    text: &str,
    candidates: &[Candidate],
) -> Result<Vec<String>, String> {
    let mut found: Vec<String> = Vec::new();
    let mut previous: Option<char> = None;
    for (at, c) in text.char_indices() {
        let starts_word = previous.is_none_or(|p| !is_word(p) && p != '@');
        previous = Some(c);
        if c != '@' || !starts_word {
            continue;
        }
        let rest = &text[at + 1..];
        let mut best = 0;
        let mut matched: Vec<&Candidate> = Vec::new();
        for candidate in candidates {
            let len = label_match(rest, &candidate.label)
                .into_iter()
                .chain(id_match(rest, &candidate.id))
                .max();
            match len {
                Some(len) if len > best => {
                    best = len;
                    matched = vec![candidate];
                }
                Some(len) if len == best && !matched.iter().any(|m| m.id == candidate.id) => {
                    matched.push(candidate);
                }
                _ => {}
            }
        }
        match matched.as_slice() {
            [] => {}
            [one] => {
                if !found.contains(&one.id) {
                    found.push(one.id.clone());
                }
            }
            many => {
                let mention: String = rest.chars().take(best).collect();
                let names: Vec<String> = many
                    .iter()
                    .map(|m| format!("{} ({})", m.label, m.id))
                    .collect();
                return Err(format!(
                    "@{mention} matches more than one session: {}; mention one by its id, e.g. @{}",
                    names.join(", "),
                    many[0].id
                ));
            }
        }
    }
    Ok(found)
}

impl Daemon {
    /// The visible sessions of `project` a mention may name, `except` the
    /// sender. A Smith's name comes before any label (ADR 0027): a session
    /// whose label is a Smith's name is mentionable by its id only.
    pub(super) fn peers_mention_candidates(
        &self,
        project: &str,
        except: Option<&str>,
    ) -> Vec<Candidate> {
        let now = now_secs();
        let entries: Vec<wire::PeerInfo> = self
            .tasks
            .values()
            .filter(|task| Some(task.id.as_str()) != except)
            .filter(|task| self.peer_visible(task, project))
            .map(|task| self.peer_entry(task, now))
            .collect();
        let smith_names: Vec<String> = entries
            .iter()
            .filter(|entry| entry.kind == wire::PeerKind::Smith)
            .map(|entry| wire::peer_label(entry).to_lowercase())
            .collect();
        entries
            .iter()
            .map(|entry| {
                let label = wire::peer_label(entry);
                let shadowed = entry.kind != wire::PeerKind::Smith
                    && smith_names.contains(&label.to_lowercase());
                Candidate {
                    id: entry.id.clone(),
                    label: if shadowed { String::new() } else { label },
                }
            })
            .collect()
    }

    /// An agent's post: recorded, then each mentioned peer sent the text as a
    /// direct message through the guard (ADR 0026 invariant 16).
    pub(super) async fn peers_agent_post(
        &mut self,
        from: &str,
        project: &str,
        text: String,
        channel: Option<String>,
    ) -> Result<wire::PeerSendResult, String> {
        let candidates = self.peers_mention_candidates(project, Some(from));
        let mentions = resolve_mentions(&text, &candidates)?;
        let woken = match channel.as_deref() {
            Some(id) => self.conversation_members(id, Some(from)),
            None => Vec::new(),
        };
        let mut result = self.peers_post(from, project, text.clone(), mentions.clone(), channel)?;
        if let Some(post) = result.message.as_mut() {
            self.conversation_wake(post).await;
        }
        if mentions.is_empty() {
            return Ok(result);
        }
        let post_id = result.message.as_ref().map(|m| m.id);
        let mut reached = Vec::new();
        let mut notices = Vec::new();
        for to in mentions {
            if woken.contains(&to) {
                reached.push(to);
                continue;
            }
            match self
                .peers_direct(from, project, &to, text.clone(), post_id)
                .await
            {
                Ok(sent) => {
                    reached.push(to);
                    notices.extend(sent.notice);
                }
                Err(error) => notices.push(format!("@{}: {error}", self.peers_label(Some(&to)))),
            }
        }
        if let Some(post) = result.message.as_mut() {
            self.peers_set_mentions(post, reached);
        }
        result.notice = (!notices.is_empty()).then(|| notices.join("\n"));
        Ok(result)
    }

    /// Narrow a post's mentions to the sessions it reached and re-announce it.
    pub(super) fn peers_set_mentions(
        &mut self,
        post: &mut wire::PeerMessage,
        reached: Vec<String>,
    ) {
        if post.mentions == reached {
            return;
        }
        post.mentions = reached;
        if let Some(kept) = self
            .peers
            .posts
            .get_mut(&(post.project.clone(), post.channel_id.clone()))
            .and_then(|posts| posts.iter_mut().find(|p| p.id == post.id))
        {
            kept.mentions = post.mentions.clone();
        }
        self.peers_record(post);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidates() -> Vec<Candidate> {
        [
            ("t_ab12cd34", "Fix login"),
            ("t_ab99ffff", "Fix"),
            ("t_0000aaaa", "Docs"),
            ("t_1111bbbb", "Docs"),
        ]
        .into_iter()
        .map(|(id, label)| Candidate {
            id: id.into(),
            label: label.into(),
        })
        .collect()
    }

    /// The vectors the desktop's mirror (`desktop/src/lib/peerMentions.ts`) runs too.
    #[test]
    fn the_shared_vectors_resolve_as_written() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/mention-vectors.json"
        )))
        .unwrap();
        let candidates: Vec<Candidate> = vectors["candidates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| Candidate {
                id: c["id"].as_str().unwrap().into(),
                label: c["label"].as_str().unwrap().into(),
            })
            .collect();
        let ids = |value: &serde_json::Value| -> Vec<String> {
            value
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap().to_string())
                .collect()
        };
        for case in vectors["cases"].as_array().unwrap() {
            let text = case["text"].as_str().unwrap();
            let result = resolve_mentions(text, &candidates);
            if case.get("ambiguous").is_some() {
                let error = result.unwrap_err();
                for id in ids(&case["ambiguous"]) {
                    assert!(error.contains(&id), "{text}: {error}");
                }
            } else {
                assert_eq!(result, Ok(ids(&case["found"])), "{text}");
            }
        }
    }

    #[test]
    fn the_longest_label_wins_case_insensitive() {
        let found = resolve_mentions("@fix LOGIN please, and @Fix too", &candidates()).unwrap();
        assert_eq!(found, vec!["t_ab12cd34", "t_ab99ffff"]);
    }

    #[test]
    fn a_label_must_end_at_a_word_boundary() {
        assert_eq!(
            resolve_mentions("@Fixer", &candidates()).unwrap(),
            Vec::<String>::new()
        );
    }

    #[test]
    fn an_id_prefix_of_four_names_a_session() {
        let found = resolve_mentions("@t_ab12 and @0000aa", &candidates()).unwrap();
        assert_eq!(found, vec!["t_ab12cd34", "t_0000aaaa"]);
        assert!(resolve_mentions("@ab1", &candidates()).unwrap().is_empty());
    }

    #[test]
    fn an_ambiguous_mention_lists_the_candidates() {
        let error = resolve_mentions("ask @Docs", &candidates()).unwrap_err();
        assert!(error.contains("Docs (t_0000aaaa)"), "{error}");
        assert!(error.contains("Docs (t_1111bbbb)"), "{error}");
    }

    #[test]
    fn mid_word_and_unknown_ats_are_text() {
        let found = resolve_mentions("mail me@Docs.dev or use @tauri-apps/api", &candidates());
        assert_eq!(found, Ok(Vec::new()));
    }

    #[test]
    fn a_session_mentioned_twice_is_reached_once() {
        let found = resolve_mentions("@Docs… no, @t_0000 @t_0000aaaa", &candidates()[..3]);
        assert_eq!(found, Ok(vec!["t_0000aaaa".to_string()]));
    }
}
