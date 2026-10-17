//! What a prompt carries for its peers (ADR 0026): a direct message framed as
//! a peer's, and the digest of channel posts and held messages the receiver
//! has not seen. Nothing here submits a prompt; it rides on one being made.

use warpforge_protocol as wire;

use crate::daemon::acp::TurnInitiator;
use crate::daemon::actor::Daemon;
use crate::daemon::prompt::{PeerDelivery, PreparedPrompt, PromptContent};
use crate::mcp::untrusted::{peer_messages, PeerItem};

/// Channel posts in one digest, and their characters: older ones are omitted.
pub(crate) const DIGEST_ITEMS: usize = 10;
pub(crate) const DIGEST_CHARS: usize = 2000;
/// Held direct messages in one digest, and their characters: the rest wait for
/// the next one. Never clipped — the sender was told the message would arrive.
pub(crate) const HELD_ITEMS: usize = 10;
pub(crate) const HELD_CHARS: usize = 8000;
/// Channel posts kept in memory per project for the digests.
pub(crate) const POSTS_KEPT: usize = 100;
const DIGEST_LABEL: &str = "Team digest";

/// A digest line: whose message, and whether it was a channel post.
struct Item {
    id: u64,
    from: String,
    /// The sending task; `None` for the user.
    task: Option<String>,
    channel: bool,
    /// The named channel of a post; `None` for `#general`.
    room: Option<String>,
    text: String,
}

/// The oldest held messages that fit, whole; the first one always.
/// @returns the messages this digest carries
fn take_held(mut held: Vec<Item>) -> Vec<Item> {
    held.sort_by_key(|item| item.id);
    let mut kept: Vec<Item> = Vec::new();
    let mut chars = 0;
    for item in held {
        let len = item.text.chars().count();
        if !kept.is_empty() && (kept.len() == HELD_ITEMS || chars + len > HELD_CHARS) {
            break;
        }
        chars += len;
        kept.push(item);
    }
    kept
}

/// The newest posts within the caps, oldest first, the newest one always,
/// clipped to the character cap when it alone is over.
/// @returns the kept posts and how many older ones were left out
fn fit_posts(mut posts: Vec<Item>) -> (Vec<Item>, usize) {
    posts.sort_by_key(|item| item.id);
    let mut kept: Vec<Item> = Vec::new();
    let mut chars = 0;
    while let Some(mut item) = posts.pop() {
        let len = item.text.chars().count();
        if kept.is_empty() && len > DIGEST_CHARS {
            item.text = item.text.chars().take(DIGEST_CHARS).collect();
        } else if kept.len() == DIGEST_ITEMS || chars + len > DIGEST_CHARS {
            posts.push(item);
            break;
        }
        chars += item.text.chars().count();
        kept.push(item);
    }
    kept.reverse();
    (kept, posts.len())
}

impl Daemon {
    /// Give a prompt about to be submitted to `task_id` what it delivers: the
    /// framed direct message of a `Peer` turn, and the digest. A prompt with
    /// no content starts no turn, so it gets nothing.
    /// @param task_id the receiving task
    /// @param initiator who asked for the turn
    /// @param direct the record a `Peer` turn delivers
    /// @param prompt the prepared prompt
    /// @returns the prompt with its peer blocks and delivery
    pub(crate) fn peers_prepare(
        &mut self,
        task_id: &str,
        initiator: TurnInitiator,
        direct: Option<u64>,
        mut prompt: PreparedPrompt,
    ) -> PreparedPrompt {
        let direct = direct
            .filter(|_| initiator == TurnInitiator::Peer)
            .and_then(|id| self.peers.in_flight.get(&id).cloned());
        if let Some(record) = direct {
            debug_assert!(
                record.from_task.is_some(),
                "only an agent's direct message is a Peer turn; the user's is a User prompt"
            );
            let from = self.peers_label(record.from_task.as_deref());
            let item = PeerItem {
                from: record
                    .from_task
                    .as_deref()
                    .map(|task| (from.as_str(), task)),
                channel: false,
                room: None,
                text: &record.text,
            };
            prompt.content = vec![PromptContent::Context(peer_messages(&[item], 0))];
            prompt.peer.direct = Some(record.id);
            prompt
                .peer
                .transcript
                .push(wire::SessionUpdate::PeerMessage {
                    message_ids: vec![record.id],
                    from_task: record.from_task.clone(),
                    from_label: from,
                    to_task: None,
                    to_label: None,
                    text: record.text.clone(),
                    direction: wire::PeerDirection::Received,
                });
        }
        if prompt.content.is_empty() {
            return prompt;
        }
        if let Some((block, delivery)) = self.peers_digest(task_id) {
            prompt.content.insert(0, PromptContent::Context(block));
            prompt.peer.absorb(delivery);
        }
        prompt
    }

    /// The unseen posts and held messages for `task_id`, framed, and what
    /// delivering them changes; reserves them for this prompt.
    fn peers_digest(&mut self, task_id: &str) -> Option<(String, PeerDelivery)> {
        let task = self.tasks.get(task_id)?;
        if !self.peer_visible(task, &task.project) || self.peers.muted.contains(task_id) {
            return None;
        }
        let (project, created_at) = (task.project.clone(), task.created_at);
        let cursor = self.peers.cursors.get(task_id).copied();
        let reserved = self.peers.reserved.get(task_id);
        let unseen_post = |post: &&wire::PeerMessage| {
            post.from_task.as_deref() != Some(task_id)
                && !post.mentions.iter().any(|m| m == task_id)
                && cursor.map_or(post.created_at >= created_at, |c| post.id > c)
                && !reserved.is_some_and(|r| r.contains(&post.id))
        };
        let rooms = self.channels_of(task_id);
        let posts: Vec<wire::PeerMessage> = self
            .peers
            .posts
            .iter()
            .filter(|((p, channel), _)| match channel {
                None => *p == project,
                Some(id) => rooms.contains_key(id),
            })
            .flat_map(|(_, posts)| posts)
            .filter(unseen_post)
            .cloned()
            .collect();
        let held: Vec<wire::PeerMessage> = self
            .peers
            .held
            .iter()
            .filter(|m| m.to_task.as_deref() == Some(task_id))
            .filter(|m| !reserved.is_some_and(|r| r.contains(&m.id)))
            .cloned()
            .collect();
        if posts.is_empty() && held.is_empty() {
            return None;
        }

        let item = |m: &wire::PeerMessage| Item {
            id: m.id,
            from: self.peers_label(m.from_task.as_deref()),
            task: m.from_task.clone(),
            channel: m.to_task.is_none(),
            room: m.channel_id.as_ref().and_then(|id| rooms.get(id)).cloned(),
            text: m.text.clone(),
        };
        let held_kept = take_held(held.iter().map(item).collect());
        let (mut posts_kept, omitted) = fit_posts(posts.iter().map(item).collect());
        posts_kept.sort_by(|a, b| (&a.room, a.id).cmp(&(&b.room, b.id)));
        let kept: Vec<Item> = held_kept.into_iter().chain(posts_kept).collect();
        let mut delivery = PeerDelivery {
            held: kept.iter().filter(|i| !i.channel).map(|i| i.id).collect(),
            cursor: posts.iter().map(|p| p.id).max(),
            ..Default::default()
        };
        let lines: Vec<String> = kept
            .iter()
            .map(|i| match &i.room {
                Some(room) => format!("#{room} {}: {}", i.from, i.text),
                None => format!("{}: {}", i.from, i.text),
            })
            .collect();
        delivery.transcript.push(wire::SessionUpdate::PeerMessage {
            message_ids: kept.iter().map(|i| i.id).collect(),
            from_task: None,
            from_label: DIGEST_LABEL.into(),
            to_task: None,
            to_label: None,
            text: lines.join("\n"),
            direction: wire::PeerDirection::Digest,
        });
        let framed: Vec<PeerItem<'_>> = kept
            .iter()
            .map(|i| PeerItem {
                from: i.task.as_deref().map(|task| (i.from.as_str(), task)),
                channel: i.channel,
                room: i.room.as_deref(),
                text: &i.text,
            })
            .collect();
        let block = peer_messages(&framed, omitted);
        self.peers
            .reserved
            .entry(task_id.to_string())
            .or_default()
            .extend(
                posts
                    .iter()
                    .map(|m| m.id)
                    .chain(delivery.held.iter().copied()),
            );
        Some((block, delivery))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: u64, channel: bool, text: &str) -> Item {
        Item {
            id,
            from: "peer".into(),
            task: Some("t_p".into()),
            channel,
            room: None,
            text: text.into(),
        }
    }

    #[test]
    fn the_newest_ten_posts_are_kept_oldest_first() {
        let (kept, omitted) = fit_posts((1..=13).map(|id| item(id, true, "x")).collect());
        let ids: Vec<u64> = kept.iter().map(|i| i.id).collect();
        assert_eq!(ids, (4..=13).collect::<Vec<_>>());
        assert_eq!(omitted, 3);
    }

    #[test]
    fn the_character_cap_drops_older_posts_and_clips_a_lone_long_one() {
        let long = "y".repeat(900);
        let (kept, omitted) = fit_posts(vec![
            item(1, true, &long),
            item(2, true, &long),
            item(3, true, &long),
        ]);
        assert_eq!(kept.iter().map(|i| i.id).collect::<Vec<_>>(), vec![2, 3]);
        assert_eq!(omitted, 1);
        let (kept, _) = fit_posts(vec![item(1, true, &"z".repeat(DIGEST_CHARS + 500))]);
        assert_eq!(kept[0].text.chars().count(), DIGEST_CHARS);
    }

    #[test]
    fn held_messages_go_whole_and_oldest_first_and_the_rest_wait() {
        let full = "h".repeat(4000);
        let held = take_held(vec![
            item(3, false, &full),
            item(1, false, &full),
            item(2, false, &full),
        ]);
        assert_eq!(held.iter().map(|i| i.id).collect::<Vec<_>>(), vec![1, 2]);
        assert!(held.iter().all(|i| i.text.chars().count() == 4000));
        let many = take_held((1..=12).map(|id| item(id, false, "x")).collect());
        assert_eq!(many.len(), HELD_ITEMS);
    }
}
