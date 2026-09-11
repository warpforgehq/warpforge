use anyhow::Result;
use serde_json::{json, Value};

use super::daemon_client::DaemonClient;
use super::format::tool_limit;

/// Fetch a window of retained log lines from the daemon and render them. The
/// `after` index and `limit` window the raw buffer first; `filter`, when set,
/// keeps only case-insensitively matching lines from that window.
pub(crate) async fn read_logs(
    client: &mut DaemonClient,
    method: &str,
    project: &str,
    kind: &str,
    key_field: &str,
    key: &str,
    args: &Value,
) -> Result<String> {
    // `after` is a monotonic seq cursor ("start from this seq"), not a buffer
    // index. Polling with the previous response's `nextSeq` makes reads
    // nearly free regardless of how many lines the ring has since dropped.
    let after = args.get("after").and_then(Value::as_u64).unwrap_or(0);
    let limit = tool_limit(args);
    let filter = args
        .get("filter")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string);
    let context = args.get("context").and_then(Value::as_u64).unwrap_or(0) as usize;
    let timestamps = args
        .get("timestamps")
        .and_then(Value::as_bool)
        .unwrap_or(true);

    // grep|tail and grep -C must see the whole retained buffer, so when a
    // filter or context is requested we fetch without a limit; otherwise honor
    // the window limit. Either way the daemon returns aligned `at` timestamps.
    let fetch_limit: Option<u32> = if filter.is_some() || context > 0 {
        None
    } else {
        Some(limit)
    };
    let mut params = json!({ "project": project, "after": after, "limit": fetch_limit });
    params[key_field] = json!(key);
    let result = client.request(method, params).await?;
    let lines: Vec<String> = result
        .get("lines")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|l| l.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let at: Vec<u64> = result
        .get("at")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_u64()).collect())
        .unwrap_or_default();
    let next_seq: u64 = result
        .get("nextSeq")
        .and_then(Value::as_u64)
        .unwrap_or(after);

    let body = render_log_selection(&lines, &at, filter.as_deref(), context, limit, timestamps);
    if body.is_empty() {
        return Ok(match filter {
            Some(f) => format!("[{kind}:{key}] no lines match filter '{f}'"),
            None => format!("[{kind}:{key}] no matching logs"),
        });
    }
    let count = body.lines().count();
    let poll = if next_seq > 0 {
        format!("\n\ncursor: pass `after: {next_seq}` to read only lines newer than these.")
    } else {
        String::new()
    };
    Ok(format!(
        "[{kind}:{key}] {count} line(s){poll}\n```\n{body}\n```"
    ))
}

/// Pure selection used by [`read_logs`] (and unit-tested here): filter the
/// whole buffer (grep), expand each match by `context` (grep -C), then keep the
/// newest `limit` lines (tail). Returns rendered lines with optional UTC
/// timestamps, or an empty string when nothing survives.
pub(crate) fn render_log_selection(
    lines: &[String],
    at: &[u64],
    filter: Option<&str>,
    context: usize,
    limit: u32,
    timestamps: bool,
) -> String {
    let n = lines.len();
    let mut keep: Vec<usize> = (0..n).collect();
    if let Some(filter) = filter.filter(|s| !s.is_empty()) {
        let needle = filter.to_lowercase();
        let matches: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.to_lowercase().contains(&needle))
            .map(|(i, _)| i)
            .collect();
        if matches.is_empty() {
            return String::new();
        }
        // Expand each match by `context` and merge overlapping spans.
        let mut spans: Vec<(usize, usize)> = Vec::new();
        for m in matches {
            let lo = m.saturating_sub(context);
            let hi = (m + 1 + context).min(n);
            match spans.last_mut() {
                Some((_, last_hi)) if lo <= *last_hi => *last_hi = (*last_hi).max(hi),
                _ => spans.push((lo, hi)),
            }
        }
        keep = spans.into_iter().flat_map(|(lo, hi)| lo..hi).collect();
    }
    if keep.len() > limit as usize {
        keep = keep[keep.len() - limit as usize..].to_vec();
    }
    keep.into_iter()
        .map(|i| {
            let text = &lines[i];
            if timestamps {
                let ts = at.get(i).copied().map(fmt_utc).unwrap_or_default();
                format!("[{ts}] {text}")
            } else {
                text.clone()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Format epoch millis as `YYYY-MM-DD HH:MM:SSZ` in UTC. Self-contained so we
/// avoid pulling a chrono-style dependency into the daemon. The `Z` is not
/// decoration: without it a reader in a non-UTC zone reads the offset from
/// their own clock as the daemon lagging behind.
pub(crate) fn fmt_utc(ms: u64) -> String {
    let secs = (ms / 1000) as i64;
    let (y, mo, d) = civil_from_days(secs.div_euclid(86400));
    let rem = secs.rem_euclid(86400);
    format!(
        "{y:04}-{mo:02}-{d:02} {:02}:{:02}:{:02}Z",
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

/// Howard Hinnant's `civil_from_days`: days since 1970-01-01 -> (year, month, day).
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}
