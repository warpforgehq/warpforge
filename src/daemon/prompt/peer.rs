//! What a prompt carries for peer messaging (ADR 0026): the feed records it
//! delivers and the chat entries to write, all applied when its turn starts.

use warpforge_protocol as wire;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PeerDelivery {
    /// The direct message this `Peer` turn delivers.
    pub direct: Option<u64>,
    /// Held direct messages carried in the digest.
    pub held: Vec<u64>,
    /// Held direct messages the digest had no room for.
    pub omitted_held: Vec<u64>,
    /// The newest channel post the digest covered, omitted ones included.
    pub cursor: Option<u64>,
    /// The receiver's chat entries for this turn.
    pub transcript: Vec<wire::SessionUpdate>,
}

impl PeerDelivery {
    /// @returns whether the prompt delivers nothing to the feed
    pub fn is_empty(&self) -> bool {
        self.direct.is_none()
            && self.held.is_empty()
            && self.omitted_held.is_empty()
            && self.cursor.is_none()
    }

    /// Fold another prompt's delivery into this one, for a merged turn.
    /// @param other the later prompt's delivery
    pub fn absorb(&mut self, other: PeerDelivery) {
        self.direct = self.direct.or(other.direct);
        self.held.extend(other.held);
        self.omitted_held.extend(other.omitted_held);
        self.cursor = self.cursor.max(other.cursor);
        self.transcript.extend(other.transcript);
    }
}
