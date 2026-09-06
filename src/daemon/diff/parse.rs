//! Unified-diff parsing: git's text output into the wire `FileDiff`/`Hunk`
//! shape.

use warpforge_protocol as wire;

pub(super) fn parse_unified(text: &str) -> Vec<wire::FileDiff> {
    let mut files: Vec<wire::FileDiff> = Vec::new();
    let mut cur: Option<wire::FileDiff> = None;
    let mut hunk: Option<wire::Hunk> = None;

    fn flush_hunk(cur: &mut Option<wire::FileDiff>, hunk: &mut Option<wire::Hunk>) {
        if let (Some(f), Some(h)) = (cur.as_mut(), hunk.take()) {
            f.hunks.push(h);
        }
    }

    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            flush_hunk(&mut cur, &mut hunk);
            if let Some(f) = cur.take() {
                files.push(f);
            }
            let (a, b) = header_paths(rest);
            cur = Some(wire::FileDiff {
                path: b.unwrap_or_default(),
                old_path: a,
                status: wire::FileDiffStatus::Modified,
                hunks: Vec::new(),
            });
            continue;
        }

        if line.starts_with("@@") {
            flush_hunk(&mut cur, &mut hunk);
            hunk = parse_hunk_header(line);
            continue;
        }

        // Inside a hunk body, prefixed lines are content (disambiguates "-x"
        // removals from the "--- a/…" header, which only appears before @@).
        if let Some(h) = hunk.as_mut() {
            if line.starts_with('\\') {
                continue; // "\ No newline at end of file"
            }
            if line.starts_with(' ') || line.starts_with('+') || line.starts_with('-') {
                h.lines.push(line.to_string());
            }
            continue;
        }

        let Some(f) = cur.as_mut() else { continue };
        if line.starts_with("new file mode") {
            f.status = wire::FileDiffStatus::Added;
        } else if line.starts_with("deleted file mode") {
            f.status = wire::FileDiffStatus::Deleted;
        } else if let Some(x) = line.strip_prefix("rename from ") {
            f.old_path = Some(x.to_string());
            f.status = wire::FileDiffStatus::Renamed;
        } else if let Some(x) = line.strip_prefix("rename to ") {
            f.path = x.to_string();
            f.status = wire::FileDiffStatus::Renamed;
        } else if let Some(x) = line.strip_prefix("--- ") {
            if let Some(p) = x.strip_prefix("a/") {
                f.old_path = Some(p.to_string());
            }
        } else if let Some(x) = line.strip_prefix("+++ ") {
            if let Some(p) = x.strip_prefix("b/") {
                f.path = p.to_string();
            }
        }
    }

    flush_hunk(&mut cur, &mut hunk);
    if let Some(f) = cur.take() {
        files.push(f);
    }
    files
}

fn header_paths(rest: &str) -> (Option<String>, Option<String>) {
    let mut it = rest.split_whitespace();
    let a = it
        .next()
        .map(|s| s.strip_prefix("a/").unwrap_or(s).to_string());
    let b = it
        .next()
        .map(|s| s.strip_prefix("b/").unwrap_or(s).to_string());
    (a, b)
}

fn parse_hunk_header(line: &str) -> Option<wire::Hunk> {
    let core = line.strip_prefix("@@ ")?;
    let end = core.find(" @@")?;
    let mut parts = core[..end].split_whitespace();
    let (old_start, old_lines) = parse_range(parts.next()?.strip_prefix('-')?);
    let (new_start, new_lines) = parse_range(parts.next()?.strip_prefix('+')?);
    Some(wire::Hunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        lines: Vec::new(),
        resolution: None,
    })
}

fn parse_range(s: &str) -> (u32, u32) {
    let mut it = s.split(',');
    let start = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let lines = it.next().and_then(|x| x.parse().ok()).unwrap_or(1);
    (start, lines)
}
