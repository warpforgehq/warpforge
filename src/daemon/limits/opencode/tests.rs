use super::*;

#[test]
fn maps_real_fixture() {
    let body: serde_json::Value = serde_json::from_str(r#"{"usage":{"rolling":{"status":"ok","percent":2,"resetsAt":"2026-08-29T22:45:23.137Z"},"weekly":{"status":"ok","percent":47,"resetsAt":"2026-08-31T00:00:00.137Z"},"monthly":{"status":"ok","percent":44,"resetsAt":"2026-09-20T16:42:14.137Z"}}}"#).unwrap();
    let w = parse_windows(&body);
    assert_eq!(w.len(), 3);
    assert_eq!(
        w.iter().find(|x| x.id == "rolling").unwrap().used_percent,
        2.0
    );
    assert_eq!(
        w.iter().find(|x| x.id == "weekly").unwrap().used_percent,
        47.0
    );
    assert_eq!(
        w.iter().find(|x| x.id == "monthly").unwrap().used_percent,
        44.0
    );
    assert!(w.iter().all(|x| x.resets_at.is_some()));
    assert_eq!(w[0].window_minutes, None);
}

#[test]
fn console_body_feeds_the_same_mapper() {
    let body: serde_json::Value = serde_json::from_str(
            r#"{"usage":{"rolling":{"status":"ok","percent":1,"resetsAt":"2026-09-23T00:33:12.809Z"},"weekly":{"status":"ok","percent":13,"resetsAt":"2026-09-28T00:00:00.000Z"},"monthly":{"status":"ok","percent":6,"resetsAt":"2026-10-20T16:42:10.000Z"}}}"#,
        )
        .unwrap();
    let limits = from_body("opencode:live", "Signed in", &body, 42);
    assert_eq!(limits.windows.len(), 3);
    assert_eq!(limits.windows[1].used_percent, 13.0);
    assert!(!limits.exhausted);
    assert_eq!(limits.error, None);
    assert_eq!(limits.fetched_at, 42);
}

#[test]
fn rate_limited_window_is_skipped() {
    let body: serde_json::Value = serde_json::from_str(
            r#"{"usage":{"rolling":{"status":"rate-limited","percent":100},"weekly":{"status":"ok","percent":10}}}"#,
        )
        .unwrap();
    let w = parse_windows(&body);
    assert_eq!(w.len(), 1);
    assert_eq!(w[0].id, "weekly");
}

#[test]
fn structured_error_message_wins_over_status() {
    let body = r#"{"type":"error","error":{"type":"EntitlementError","message":"OpenCode Go subscription required."}}"#;
    assert_eq!(
        failure_message(reqwest::StatusCode::FORBIDDEN, body),
        "OpenCode Go subscription required."
    );
    assert_eq!(
        failure_message(reqwest::StatusCode::FORBIDDEN, "<html>nope</html>"),
        "http 403 Forbidden"
    );
}

#[test]
fn console_login_reads_active_account_and_org() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("opencode.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "CREATE TABLE account (
                 id text PRIMARY KEY,
                 email text NOT NULL,
                 url text NOT NULL,
                 access_token text NOT NULL,
                 refresh_token text NOT NULL,
                 token_expiry integer,
                 time_created integer NOT NULL,
                 time_updated integer NOT NULL
             );
             CREATE TABLE account_state (
                 id integer PRIMARY KEY NOT NULL,
                 active_account_id text,
                 active_org_id text
             );
             INSERT INTO account VALUES (
                 'acc_1', 'me@example.com', 'https://opencode.ai/console',
                 'st_token', 'rt_token', 9999999999999, 0, 0
             );
             INSERT INTO account_state VALUES (1, 'acc_1', 'wrk_abc');",
    )
    .unwrap();
    drop(conn);

    let console = read_console_from(&path).unwrap();
    assert_eq!(console.token, "st_token");
    assert_eq!(console.org_id, "wrk_abc");
    assert_eq!(console.email, "me@example.com");
}

#[test]
fn expired_console_token_is_not_used() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("opencode.db");
    let conn = rusqlite::Connection::open(&path).unwrap();
    conn.execute_batch(
        "CREATE TABLE account (
                 id text PRIMARY KEY, email text NOT NULL, url text NOT NULL,
                 access_token text NOT NULL, refresh_token text NOT NULL,
                 token_expiry integer, time_created integer NOT NULL,
                 time_updated integer NOT NULL
             );
             CREATE TABLE account_state (
                 id integer PRIMARY KEY NOT NULL,
                 active_account_id text, active_org_id text
             );
             INSERT INTO account VALUES (
                 'acc_1', 'me@example.com', 'https://opencode.ai/console',
                 'st_token', 'rt_token', 1, 0, 0
             );
             INSERT INTO account_state VALUES (1, 'acc_1', 'wrk_abc');",
    )
    .unwrap();
    drop(conn);

    assert!(read_console_from(&path).is_none());
}

#[test]
fn missing_or_unreadable_db_is_not_a_login() {
    let dir = tempfile::tempdir().unwrap();
    assert!(read_console_from(&dir.path().join("nope.db")).is_none());
}
