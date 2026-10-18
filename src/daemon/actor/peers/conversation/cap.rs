//! The cap on one channel conversation (ADR 0026 addendum, invariant 25):
//! agent-originated wakes per channel per window. User posts are never
//! counted and start the window over.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

/// Four under test, so a handful of Smiths reaches the cap.
pub(crate) const CHANNEL_WAKES: usize = if cfg!(test) { 4 } else { 20 };
pub(crate) const CHANNEL_WINDOW: Duration = Duration::from_secs(10 * 60);

/// Why a wake was skipped. `alert` is set on the first skip of the window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct CapReached {
    pub alert: bool,
}

impl std::fmt::Display for CapReached {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "the Smiths in this channel woke each other {CHANNEL_WAKES} times in {} minutes; \
             post in the channel to let them go on",
            CHANNEL_WINDOW.as_secs() / 60
        )
    }
}

#[derive(Default)]
struct Window {
    wakes: VecDeque<Instant>,
    alerted: bool,
}

#[derive(Default)]
pub(crate) struct ChannelCaps {
    windows: HashMap<String, Window>,
}

impl ChannelCaps {
    /// Whether `channel` takes one more agent-originated wake; counts
    /// nothing, so a wake another rule refuses is not spent.
    /// @param channel the channel id
    /// @param now the current instant
    /// @returns why it is over the cap
    pub(crate) fn check(&mut self, channel: &str, now: Instant) -> Result<(), CapReached> {
        let window = self.windows.entry(channel.to_string()).or_default();
        drain(window, now);
        if window.wakes.len() >= CHANNEL_WAKES {
            let alert = !window.alerted;
            window.alerted = true;
            return Err(CapReached { alert });
        }
        Ok(())
    }

    /// Count one agent-originated wake in `channel`.
    /// @param channel the channel id
    /// @param now the current instant
    pub(crate) fn count(&mut self, channel: &str, now: Instant) {
        self.windows
            .entry(channel.to_string())
            .or_default()
            .wakes
            .push_back(now);
    }

    /// The user posted in `channel`: its window starts over.
    /// @param channel the channel id
    pub(crate) fn reset(&mut self, channel: &str) {
        self.windows.remove(channel);
    }

    /// Let lapsed wakes go.
    /// @param now the current instant
    /// @returns the channels whose alerted window has room again
    pub(crate) fn expire(&mut self, now: Instant) -> Vec<String> {
        let mut cleared = Vec::new();
        self.windows.retain(|channel, window| {
            drain(window, now);
            if window.alerted && window.wakes.len() < CHANNEL_WAKES {
                cleared.push(channel.clone());
                window.alerted = false;
            }
            !window.wakes.is_empty()
        });
        cleared
    }
}

fn drain(window: &mut Window, now: Instant) {
    while window
        .wakes
        .front()
        .is_some_and(|at| now.duration_since(*at) >= CHANNEL_WINDOW)
    {
        window.wakes.pop_front();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cap_alerts_once_and_a_reset_or_time_lifts_it() {
        let mut caps = ChannelCaps::default();
        let start = Instant::now();
        assert!(caps.check("ch_1", start).is_ok());
        assert!(caps.check("ch_1", start).is_ok(), "a check counts nothing");
        for _ in 0..CHANNEL_WAKES {
            caps.count("ch_1", start);
        }
        assert_eq!(caps.check("ch_1", start), Err(CapReached { alert: true }));
        assert_eq!(caps.check("ch_1", start), Err(CapReached { alert: false }));
        assert!(caps.check("ch_2", start).is_ok(), "per channel");

        caps.reset("ch_1");
        assert!(caps.check("ch_1", start).is_ok());

        for _ in 0..CHANNEL_WAKES {
            caps.count("ch_1", start);
        }
        assert!(caps.check("ch_1", start).is_err());
        let later = start + CHANNEL_WINDOW;
        assert_eq!(caps.expire(later), vec!["ch_1".to_string()]);
        assert!(caps.check("ch_1", later).is_ok());
    }
}
