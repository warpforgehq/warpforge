//! The loop guard (ADR 0026): a backstop for runaway exchanges between peer
//! sessions. Every limit expires on time alone; a `User` or `Automation` turn
//! may reset a pair's window early, never has to.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

pub(crate) const PAIR_WINDOW_MESSAGES: u32 = 12;
pub(crate) const PAIR_QUIET: Duration = Duration::from_secs(10 * 60);
pub(crate) const COOLDOWN: Duration = Duration::from_secs(5);
pub(crate) const RECEIVER_TURNS_PER_HOUR: usize = 30;
pub(crate) const MAX_TEXT_CHARS: usize = 4000;
/// How long an undelivered message holds its route before the slot lapses.
pub(crate) const QUEUED_TTL: Duration = Duration::from_secs(30 * 60);
const HOUR: Duration = Duration::from_secs(60 * 60);

/// A rule that refused a message. Its text is the tool error the sender sees.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GuardRefusal {
    TooLong {
        chars: usize,
    },
    AlreadyQueued,
    Cooldown,
    /// `alert` is set on the first refusal of the pair's window only.
    PairWindow {
        alert: bool,
    },
    ReceiverHourly,
}

impl std::fmt::Display for GuardRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLong { chars } => write!(
                f,
                "message too long: {chars} characters, the limit is {MAX_TEXT_CHARS}"
            ),
            Self::AlreadyQueued => f.write_str(
                "a message from this session to that peer is already waiting; wait until it is delivered",
            ),
            Self::Cooldown => write!(
                f,
                "one message per {} seconds to the same peer",
                COOLDOWN.as_secs()
            ),
            Self::PairWindow { .. } => write!(
                f,
                "these two sessions exchanged {PAIR_WINDOW_MESSAGES} messages without a pause; \
                 the limit lifts after {} quiet minutes",
                PAIR_QUIET.as_secs() / 60
            ),
            Self::ReceiverHourly => write!(
                f,
                "that peer already received {RECEIVER_TURNS_PER_HOUR} peer messages this hour"
            ),
        }
    }
}

impl GuardRefusal {
    /// @returns whether this refusal raises the user's one alert for its window
    pub(crate) fn alert(&self) -> bool {
        matches!(self, Self::PairWindow { alert: true })
    }
}

struct PairWindow {
    count: u32,
    last: Instant,
    alerted: bool,
}

/// A pair of task ids, smaller first, so either direction finds one window.
pub(crate) type Pair = (String, String);

/// In-memory counters; nothing here survives a restart.
#[derive(Default)]
pub(crate) struct PeerGuard {
    windows: HashMap<Pair, PairWindow>,
    /// Last accepted message per sender → receiver.
    last_sent: HashMap<(String, String), Instant>,
    /// Accepted messages per receiver within the last hour, oldest first.
    received: HashMap<String, VecDeque<Instant>>,
    /// Sender → receiver routes with a message still waiting, and since when.
    queued: HashMap<(String, String), Instant>,
    /// Alerted windows that ended since the last [`PeerGuard::take_cleared`].
    cleared: Vec<Pair>,
}

/// @param a one task id
/// @param b the other task id
/// @returns the key of their window
pub(crate) fn pair(a: &str, b: &str) -> Pair {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

/// The message and post length rule.
/// @param text the message body
/// @returns the refusal when the body is over the cap
pub(crate) fn check_length(text: &str) -> Result<(), GuardRefusal> {
    let chars = text.chars().count();
    if chars > MAX_TEXT_CHARS {
        return Err(GuardRefusal::TooLong { chars });
    }
    Ok(())
}

impl PeerGuard {
    /// Check a direct message against every rule and, when it passes, count
    /// it and reserve the sender's queued slot for that receiver.
    /// @param from the sending task
    /// @param to the receiving task
    /// @param text the message body
    /// @param now the current instant
    /// @returns the first rule that refuses it
    pub(crate) fn admit(
        &mut self,
        from: &str,
        to: &str,
        text: &str,
        now: Instant,
    ) -> Result<(), GuardRefusal> {
        self.expire(now);
        check_length(text)?;
        let direction = (from.to_string(), to.to_string());
        if self.queued.contains_key(&direction) {
            return Err(GuardRefusal::AlreadyQueued);
        }
        if self.last_sent.contains_key(&direction) {
            return Err(GuardRefusal::Cooldown);
        }
        if let Some(window) = self.windows.get_mut(&pair(from, to)) {
            if window.count >= PAIR_WINDOW_MESSAGES {
                let alert = !window.alerted;
                window.alerted = true;
                return Err(GuardRefusal::PairWindow { alert });
            }
        }
        if self.received.get(to).map_or(0, VecDeque::len) >= RECEIVER_TURNS_PER_HOUR {
            return Err(GuardRefusal::ReceiverHourly);
        }

        let window = self.windows.entry(pair(from, to)).or_insert(PairWindow {
            count: 0,
            last: now,
            alerted: false,
        });
        window.count += 1;
        window.last = now;
        self.last_sent.insert(direction.clone(), now);
        self.received
            .entry(to.to_string())
            .or_default()
            .push_back(now);
        self.queued.insert(direction, now);
        Ok(())
    }

    /// Free the sender's queued slot: its message was delivered, refused, or
    /// dropped with the receiver's session. Unreleased slots expire on time.
    /// @param from the sending task
    /// @param to the receiving task
    pub(crate) fn release(&mut self, from: &str, to: &str) {
        self.queued.remove(&(from.to_string(), to.to_string()));
    }

    /// A `User` or `Automation` turn started: every window the task is in
    /// starts over.
    /// @param task_id the task whose turn started
    pub(crate) fn reset_for(&mut self, task_id: &str) {
        let cleared = &mut self.cleared;
        self.windows.retain(|key, window| {
            let keep = key.0 != task_id && key.1 != task_id;
            if !keep && window.alerted {
                cleared.push(key.clone());
            }
            keep
        });
    }

    /// Drop everything counted for a deleted task.
    /// @param task_id the deleted task
    pub(crate) fn forget(&mut self, task_id: &str) {
        self.reset_for(task_id);
        self.last_sent
            .retain(|(from, to), _| from != task_id && to != task_id);
        self.queued
            .retain(|(from, to), _| from != task_id && to != task_id);
        self.received.remove(task_id);
    }

    /// Let every limit that ran out lapse; the actor's minute tick calls this
    /// so an alert ends without a new message.
    /// @param now the current instant
    pub(crate) fn expire(&mut self, now: Instant) {
        let cleared = &mut self.cleared;
        self.windows.retain(|key, window| {
            let keep = now.duration_since(window.last) < PAIR_QUIET;
            if !keep && window.alerted {
                cleared.push(key.clone());
            }
            keep
        });
        self.last_sent
            .retain(|_, at| now.duration_since(*at) < COOLDOWN);
        self.queued
            .retain(|_, at| now.duration_since(*at) < QUEUED_TTL);
        self.received.retain(|_, times| {
            while times
                .front()
                .is_some_and(|at| now.duration_since(*at) >= HOUR)
            {
                times.pop_front();
            }
            !times.is_empty()
        });
    }

    /// @returns the alerted windows that ended since the last call
    pub(crate) fn take_cleared(&mut self) -> Vec<Pair> {
        std::mem::take(&mut self.cleared)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEC: Duration = Duration::from_secs(1);

    /// Alternate a ↔ b, spaced past the cooldown, delivering each message.
    fn exchange(guard: &mut PeerGuard, start: Instant, count: u32) -> Instant {
        let mut now = start;
        for i in 0..count {
            let (from, to) = if i % 2 == 0 { ("a", "b") } else { ("b", "a") };
            guard.admit(from, to, "hi", now).expect("within the window");
            guard.release(from, to);
            now += COOLDOWN;
        }
        now
    }

    #[test]
    fn pair_window_trips_after_twelve_and_alerts_once() {
        let mut guard = PeerGuard::default();
        let now = exchange(&mut guard, Instant::now(), PAIR_WINDOW_MESSAGES);
        let first = guard.admit("a", "b", "hi", now).unwrap_err();
        assert_eq!(first, GuardRefusal::PairWindow { alert: true });
        assert!(first.alert());
        let again = guard.admit("b", "a", "hi", now + SEC).unwrap_err();
        assert_eq!(again, GuardRefusal::PairWindow { alert: false });
        assert!(guard.admit("a", "c", "hi", now).is_ok());
    }

    #[test]
    fn pair_window_resets_after_ten_quiet_minutes() {
        let mut guard = PeerGuard::default();
        let now = exchange(&mut guard, Instant::now(), PAIR_WINDOW_MESSAGES);
        let last = now - COOLDOWN;
        assert!(guard
            .admit("a", "b", "hi", last + PAIR_QUIET - SEC)
            .is_err());
        assert!(guard.admit("a", "b", "hi", last + PAIR_QUIET).is_ok());
    }

    #[test]
    fn refused_retries_do_not_keep_the_window_alive() {
        let mut guard = PeerGuard::default();
        let now = exchange(&mut guard, Instant::now(), PAIR_WINDOW_MESSAGES);
        let last = now - COOLDOWN;
        for minute in 1..10 {
            let at = last + Duration::from_secs(minute * 60);
            assert!(guard.admit("a", "b", "hi", at).is_err());
        }
        assert!(guard.admit("a", "b", "hi", last + PAIR_QUIET).is_ok());
    }

    #[test]
    fn a_user_turn_resets_the_window_early_and_rearms_the_alert() {
        let mut guard = PeerGuard::default();
        let now = exchange(&mut guard, Instant::now(), PAIR_WINDOW_MESSAGES);
        assert!(guard.admit("a", "b", "hi", now).unwrap_err().alert());
        guard.reset_for("b");
        let now = exchange(&mut guard, now, PAIR_WINDOW_MESSAGES);
        assert!(guard.admit("a", "b", "hi", now).unwrap_err().alert());
    }

    #[test]
    fn cooldown_holds_one_direction_for_five_seconds() {
        let mut guard = PeerGuard::default();
        let start = Instant::now();
        guard.admit("a", "b", "hi", start).unwrap();
        guard.release("a", "b");
        assert_eq!(
            guard.admit("a", "b", "hi", start + COOLDOWN - SEC),
            Err(GuardRefusal::Cooldown)
        );
        assert!(guard.admit("b", "a", "answer", start + SEC).is_ok());
        assert!(guard.admit("a", "b", "hi", start + COOLDOWN).is_ok());
    }

    #[test]
    fn one_queued_message_per_sender_per_receiver() {
        let mut guard = PeerGuard::default();
        let start = Instant::now();
        guard.admit("a", "b", "hi", start).unwrap();
        assert_eq!(
            guard.admit("a", "b", "hi", start + COOLDOWN),
            Err(GuardRefusal::AlreadyQueued)
        );
        assert!(guard.admit("c", "b", "hi", start + COOLDOWN).is_ok());
        guard.release("a", "b");
        assert!(guard.admit("a", "b", "hi", start + COOLDOWN).is_ok());
    }

    #[test]
    fn receiver_takes_thirty_peer_messages_per_hour() {
        let mut guard = PeerGuard::default();
        let start = Instant::now();
        for i in 0..RECEIVER_TURNS_PER_HOUR {
            let from = format!("s{i}");
            guard.admit(&from, "r", "hi", start).unwrap();
            guard.release(&from, "r");
        }
        assert_eq!(
            guard.admit("late", "r", "hi", start + SEC),
            Err(GuardRefusal::ReceiverHourly)
        );
        assert!(guard.admit("late", "r", "hi", start + HOUR).is_ok());
    }

    #[test]
    fn text_over_four_thousand_characters_is_refused() {
        let mut guard = PeerGuard::default();
        let long = "é".repeat(MAX_TEXT_CHARS + 1);
        assert_eq!(
            guard.admit("a", "b", &long, Instant::now()),
            Err(GuardRefusal::TooLong {
                chars: MAX_TEXT_CHARS + 1
            })
        );
        assert!(check_length(&"é".repeat(MAX_TEXT_CHARS)).is_ok());
    }

    #[test]
    fn an_undelivered_reservation_lapses_after_thirty_minutes() {
        let mut guard = PeerGuard::default();
        let start = Instant::now();
        guard.admit("a", "b", "hi", start).unwrap();
        assert_eq!(
            guard.admit("a", "b", "hi", start + QUEUED_TTL - SEC),
            Err(GuardRefusal::AlreadyQueued)
        );
        assert!(guard.admit("a", "b", "hi", start + QUEUED_TTL).is_ok());
    }

    #[test]
    fn an_alerted_window_reports_its_end_once() {
        let mut guard = PeerGuard::default();
        let now = exchange(&mut guard, Instant::now(), PAIR_WINDOW_MESSAGES);
        assert!(guard.admit("b", "a", "hi", now).unwrap_err().alert());
        let last = now - COOLDOWN;
        guard.expire(last + PAIR_QUIET - SEC);
        assert!(guard.take_cleared().is_empty());
        guard.expire(last + PAIR_QUIET);
        assert_eq!(guard.take_cleared(), vec![pair("a", "b")]);
        guard.expire(last + PAIR_QUIET * 2);
        assert!(guard.take_cleared().is_empty());
    }

    #[test]
    fn a_reset_or_a_deleted_task_reports_the_alert_ended() {
        let mut guard = PeerGuard::default();
        let now = exchange(&mut guard, Instant::now(), PAIR_WINDOW_MESSAGES);
        guard.admit("a", "b", "hi", now).unwrap_err();
        guard.reset_for("a");
        assert_eq!(guard.take_cleared(), vec![pair("a", "b")]);

        let now = exchange(&mut guard, now + COOLDOWN, PAIR_WINDOW_MESSAGES);
        guard.admit("a", "b", "hi", now).unwrap_err();
        guard.admit("c", "b", "hi", now).unwrap();
        guard.forget("b");
        assert_eq!(guard.take_cleared(), vec![pair("a", "b")]);
        assert!(guard.admit("c", "b", "hi", now + SEC).is_ok());
    }
}
