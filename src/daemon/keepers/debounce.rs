use std::time::Instant;

use super::SETTLE;

/// One task's HEAD as the poll last saw it, and whether it has settled.
#[derive(Debug, Default, Clone)]
pub struct HeadWatch {
    seen: Option<(String, Instant)>,
    nudged: bool,
}

impl HeadWatch {
    /// The task's turn ended, or Warpforge made a commit in it: the next
    /// observation counts as settled.
    pub fn nudge(&mut self) {
        self.nudged = true;
    }

    /// Record a poll's HEAD and say whether it may be checked now. A nudge is
    /// consumed by the first observation outside a turn.
    /// @param head the HEAD the poll read
    /// @param now when it was read
    /// @param mid_turn whether the task's agent is working
    /// @returns whether the HEAD has settled and the task is quiet
    pub fn observe(&mut self, head: &str, now: Instant, mid_turn: bool) -> bool {
        let nudged = !mid_turn && std::mem::take(&mut self.nudged);
        let since = match &self.seen {
            Some((sha, since)) if sha == head => *since,
            _ => {
                self.seen = Some((head.to_string(), now));
                now
            }
        };
        !mid_turn && (nudged || now.duration_since(since) >= SETTLE)
    }

    /// A turn ended or Warpforge committed since the last settled observation.
    pub fn nudged(&self) -> bool {
        self.nudged
    }

    /// The HEAD the poll last saw.
    pub fn head(&self) -> Option<&str> {
        self.seen.as_ref().map(|(sha, _)| sha.as_str())
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    #[test]
    fn a_new_head_waits_for_the_settle_window() {
        let start = Instant::now();
        let mut watch = HeadWatch::default();
        assert!(!watch.observe("a", start, false));
        assert!(!watch.observe("a", start + Duration::from_secs(59), false));
        assert!(watch.observe("a", start + SETTLE, false));
    }

    #[test]
    fn a_moving_head_restarts_the_window() {
        let start = Instant::now();
        let mut watch = HeadWatch::default();
        watch.observe("a", start, false);
        assert!(!watch.observe("b", start + Duration::from_secs(50), false));
        assert!(!watch.observe("b", start + Duration::from_secs(100), false));
        assert!(watch.observe("b", start + Duration::from_secs(110), false));
        assert_eq!(watch.head(), Some("b"));
    }

    #[test]
    fn a_nudge_settles_at_once_but_never_mid_turn_and_only_once() {
        let start = Instant::now();
        let mut watch = HeadWatch::default();
        watch.nudge();
        assert!(watch.observe("a", start, false));
        assert!(!watch.observe("a", start, false), "the nudge is consumed");
        watch.nudge();
        assert!(!watch.observe("a", start, true));
        assert!(!watch.observe("a", start + SETTLE, true), "mid-turn holds");
        assert!(
            watch.observe("a", start, false),
            "the nudge survives the turn"
        );
    }
}
