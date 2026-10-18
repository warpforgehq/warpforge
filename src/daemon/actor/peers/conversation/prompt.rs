//! What a channel turn tells its Smith (ADR 0026 addendum): where the
//! conversation is, who is in it, its last posts, and how the reply works.
//! It is the prompt's text, so a thread that has to start a session first
//! hears it the same way.

use super::NOTHING_TO_ADD;
use crate::daemon::actor::Daemon;
use crate::daemon::store::StoredChannel;
use crate::mcp::untrusted::{peer_messages, PeerItem};

/// Posts a channel turn shows, the new ones always among them.
pub(crate) const CONTEXT_POSTS: usize = 15;

impl Daemon {
    /// @param thread the Smith's thread
    /// @param channel the channel the turn is for
    /// @param fresh the posts that woke it
    /// @returns the prompt text and the newest post it shows
    pub(super) fn conversation_prompt(
        &self,
        thread: &str,
        channel: &StoredChannel,
        fresh: &[u64],
    ) -> (String, u64) {
        let key = (channel.project.clone(), Some(channel.id.clone()));
        let kept: Vec<_> = self.peers.posts.get(&key).into_iter().flatten().collect();
        let shown = CONTEXT_POSTS.max(fresh.len());
        let start = kept.len().saturating_sub(shown);
        let posts = &kept[start..];
        let labels: Vec<String> = posts
            .iter()
            .map(|post| self.peers_label(post.from_task.as_deref()))
            .collect();
        let items: Vec<PeerItem<'_>> = posts
            .iter()
            .zip(&labels)
            .map(|(post, label)| PeerItem {
                from: post.from_task.as_deref().map(|task| (label.as_str(), task)),
                channel: true,
                room: Some(channel.name.as_str()),
                fresh: fresh.contains(&post.id),
                text: &post.text,
            })
            .collect();
        let mut posters: Vec<String> = Vec::new();
        for (post, label) in posts.iter().zip(&labels) {
            if fresh.contains(&post.id) && !posters.contains(label) {
                posters.push(label.clone());
            }
        }
        let others: Vec<String> = self
            .conversation_members(&channel.id, Some(thread))
            .iter()
            .map(|member| self.peers_label(Some(member)))
            .collect();
        let with = match others.is_empty() {
            true => "the user".to_string(),
            false => format!("{} and the user", others.join(", ")),
        };
        let name = &channel.name;
        let text = format!(
            "<channel_turn channel=\"{name}\" project=\"{project}\">\n\
             New posts in #{name} (project {project}) from {posters} woke you. In #{name} with \
             you: {with}.\n\
             {block}\n\
             This turn's final message is posted to #{name} as your reply; do not also post it \
             with message_agent. If you have nothing to add, answer exactly {NOTHING_TO_ADD} \
             and nothing is posted. Do not repeat what another member already said. When \
             several of you were addressed, agree briefly in #{name} who takes the work before \
             anyone starts it.\n\
             </channel_turn>",
            project = channel.project,
            posters = posters.join(", "),
            block = peer_messages(&items, start),
        );
        let newest = posts.iter().map(|post| post.id).max().unwrap_or(0);
        (text, newest)
    }
}
