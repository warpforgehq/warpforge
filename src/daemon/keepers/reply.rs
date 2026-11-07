use serde_json::Value;
use warpforge_protocol as wire;
use wire::{KeeperReply, KeeperReplyVerdict as Verdict};

/// The fixer's answers to the findings it did not fix, read from the last
/// fenced json block of its closing message (ADR 0030, *The fixer*). Anything
/// malformed is left out: a reply is advice, never a reason to fail the turn.
/// @param text the fix turn's closing message
/// @param count how many findings the fix prompt numbered
/// @returns (0-based index into the prompt's findings, the reply) pairs
pub fn parse_replies(text: &str, count: usize) -> Vec<(usize, KeeperReply)> {
    let Some(start) = text.rfind("```json") else {
        return Vec::new();
    };
    let body = &text[start + "```json".len()..];
    let body = body.find("```").map_or(body, |end| &body[..end]);
    let Ok(value) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };
    let Some(entries) = value.get("keepers").and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out: Vec<(usize, KeeperReply)> = Vec::new();
    for entry in entries {
        let Some(n) = entry.get("n").and_then(Value::as_u64) else {
            continue;
        };
        let Some(index) = (n as usize).checked_sub(1).filter(|i| *i < count) else {
            continue;
        };
        let verdict = match entry.get("verdict").and_then(Value::as_str) {
            Some("rebutted") => Verdict::Rebutted,
            Some("stale") => Verdict::Stale,
            _ => continue,
        };
        let reason = entry.get("reason").and_then(Value::as_str).map(str::trim);
        let Some(reason) = reason.filter(|r| !r.is_empty()) else {
            continue;
        };
        if out.iter().any(|(i, _)| *i == index) {
            continue;
        }
        let reply = KeeperReply {
            verdict,
            reason: reason.to_string(),
        };
        out.push((index, reply));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_block_maps_numbers_to_replies() {
        let text = "Fixed 1.\n```json\n{\"keepers\": []}\n```\nOn second thought:\n```json\n\
{\"keepers\": [{\"n\": 2, \"verdict\": \"rebutted\", \"reason\": \" intended \"}, \
{\"n\": 3, \"verdict\": \"stale\", \"reason\": \"fixed in 53a05ac8\"}]}\n```";
        let replies = parse_replies(text, 3);
        assert_eq!(replies.len(), 2);
        assert_eq!(replies[0].0, 1);
        assert_eq!(replies[0].1.verdict, Verdict::Rebutted);
        assert_eq!(replies[0].1.reason, "intended");
        assert_eq!((replies[1].0, replies[1].1.verdict), (2, Verdict::Stale));
    }

    #[test]
    fn malformed_entries_and_blocks_are_ignored() {
        let entries =
            "```json\n{\"keepers\": [{\"n\": 0, \"verdict\": \"stale\", \"reason\": \"x\"}, \
{\"n\": 4, \"verdict\": \"stale\", \"reason\": \"x\"}, {\"n\": 1, \"verdict\": \"fixed\", \
\"reason\": \"x\"}, {\"n\": 1, \"verdict\": \"stale\", \"reason\": \"  \"}, {\"n\": \"2\", \
\"verdict\": \"stale\", \"reason\": \"x\"}, {\"n\": 2, \"verdict\": \"stale\", \"reason\": \"a\"}, \
{\"n\": 2, \"verdict\": \"rebutted\", \"reason\": \"b\"}]}\n```";
        let replies = parse_replies(entries, 3);
        assert_eq!(replies.len(), 1);
        assert_eq!((replies[0].0, replies[0].1.reason.as_str()), (1, "a"));
        assert!(parse_replies("Done.", 3).is_empty());
        assert!(parse_replies("```json\n{\"keepers\": [{\"n\": 1,\n```", 3).is_empty());
        assert!(parse_replies("```json\n{\"verdict\": \"approve\"}\n```", 3).is_empty());
    }
}
