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
