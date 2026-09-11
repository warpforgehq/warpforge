use serde_json::Value;
use warpforge_protocol as wire;

pub(super) struct EditInfo {
    pub(super) path: String,
    pub(super) additions: Option<u32>,
    pub(super) deletions: Option<u32>,
    pub(super) hunks: Vec<wire::EditHunk>,
}

/// Pull edit details from ACP diff content, falling back to `locations` when
/// the agent only reports which file it touched.
pub(super) fn edit_info(update: &Value) -> Option<EditInfo> {
    if let Some(content) = update.get("content").and_then(|c| c.as_array()) {
        for item in content {
            let Some(path) = item.get("path").and_then(|p| p.as_str()) else {
                continue;
            };
            if item.get("type").and_then(|v| v.as_str()) == Some("diff") {
                let new_text = item.get("newText").and_then(|v| v.as_str());
                if let Some(new_text) = new_text {
                    let old_text = item.get("oldText").and_then(|v| v.as_str());
                    let (additions, deletions) = line_change_counts(old_text, new_text);
                    let hunks = line_change_hunks(old_text, new_text);
                    return Some(EditInfo {
                        path: path.to_string(),
                        additions: Some(additions),
                        deletions: Some(deletions),
                        hunks,
                    });
                }
            }
            return Some(EditInfo {
                path: path.to_string(),
                additions: None,
                deletions: None,
                hunks: Vec::new(),
            });
        }
    }
    if let Some(path) = update
        .get("locations")
        .and_then(|l| l.as_array())
        .and_then(|locations| locations.first())
        .and_then(|location| location.get("path"))
        .and_then(|path| path.as_str())
    {
        return Some(EditInfo {
            path: path.to_string(),
            additions: None,
            deletions: None,
            hunks: Vec::new(),
        });
    }
    None
}

/// Count the shortest line-level edit script using Myers' algorithm. The ACP
/// diff contains whole old/new texts, so this yields the familiar git-style
/// additions/deletions without shelling out or reading a moving worktree.
#[derive(Clone, Copy)]
enum LineEdit {
    Equal,
    Insert,
    Delete,
}

fn coarse_line_change_hunk(old_lines: &[&str], new_lines: &[&str]) -> Vec<wire::EditHunk> {
    let mut prefix = 0usize;
    while prefix < old_lines.len()
        && prefix < new_lines.len()
        && old_lines[prefix] == new_lines[prefix]
    {
        prefix += 1;
    }
    let mut suffix = 0usize;
    while suffix < old_lines.len().saturating_sub(prefix)
        && suffix < new_lines.len().saturating_sub(prefix)
        && old_lines[old_lines.len() - suffix - 1] == new_lines[new_lines.len() - suffix - 1]
    {
        suffix += 1;
    }
    let old_changed = &old_lines[prefix..old_lines.len() - suffix];
    let new_changed = &new_lines[prefix..new_lines.len() - suffix];
    if old_changed.is_empty() && new_changed.is_empty() {
        return Vec::new();
    }
    let mut lines = old_changed
        .iter()
        .map(|line| format!("-{line}"))
        .collect::<Vec<_>>();
    lines.extend(new_changed.iter().map(|line| format!("+{line}")));
    vec![wire::EditHunk {
        old_start: (prefix + 1).try_into().unwrap_or(u32::MAX),
        old_lines: old_changed.len().try_into().unwrap_or(u32::MAX),
        new_start: (prefix + 1).try_into().unwrap_or(u32::MAX),
        new_lines: new_changed.len().try_into().unwrap_or(u32::MAX),
        lines,
    }]
}

pub(super) fn line_change_hunks(old_text: Option<&str>, new_text: &str) -> Vec<wire::EditHunk> {
    let new_lines = new_text.lines().collect::<Vec<_>>();
    let Some(old_text) = old_text else {
        if new_lines.is_empty() {
            return Vec::new();
        }
        return vec![wire::EditHunk {
            old_start: 0,
            old_lines: 0,
            new_start: 1,
            new_lines: new_lines.len().try_into().unwrap_or(u32::MAX),
            lines: new_lines
                .into_iter()
                .map(|line| format!("+{line}"))
                .collect(),
        }];
    };
    let old_lines = old_text.lines().collect::<Vec<_>>();
    let n = old_lines.len();
    let m = new_lines.len();

    let max = n + m;
    let offset = max as isize + 1;
    let mut furthest = vec![0isize; max * 2 + 3];
    furthest[(offset + 1) as usize] = 0;
    let mut trace = Vec::with_capacity(max + 1);
    let mut final_distance = max;
    for distance in 0..=max {
        // Myers backtracking needs a trace. Bound it so a pathological whole-
        // file rewrite cannot allocate O(N×D); the coarse fallback still
        // preserves the concrete changed content and useful coordinates.
        if furthest.len().saturating_mul(trace.len().saturating_add(1)) > 4_000_000 {
            return coarse_line_change_hunk(&old_lines, &new_lines);
        }
        trace.push(furthest.clone());
        let d = distance as isize;
        let mut diagonal = -d;
        while diagonal <= d {
            let index = (offset + diagonal) as usize;
            let mut x =
                if diagonal == -d || (diagonal != d && furthest[index - 1] < furthest[index + 1]) {
                    furthest[index + 1]
                } else {
                    furthest[index - 1] + 1
                };
            let mut y = x - diagonal;
            while x < n as isize && y < m as isize && old_lines[x as usize] == new_lines[y as usize]
            {
                x += 1;
                y += 1;
            }
            furthest[index] = x;
            if x >= n as isize && y >= m as isize {
                final_distance = distance;
                break;
            }
            diagonal += 2;
        }
        if furthest[(offset + (n as isize - m as isize)) as usize] >= n as isize {
            break;
        }
    }

    let mut edits = Vec::with_capacity(n + m);
    let mut x = n as isize;
    let mut y = m as isize;
    for distance in (0..=final_distance).rev() {
        let d = distance as isize;
        let diagonal = x - y;
        let previous = &trace[distance];
        let previous_diagonal = if diagonal == -d
            || (diagonal != d
                && previous[(offset + diagonal - 1) as usize]
                    < previous[(offset + diagonal + 1) as usize])
        {
            diagonal + 1
        } else {
            diagonal - 1
        };
        let previous_x = previous[(offset + previous_diagonal) as usize];
        let previous_y = previous_x - previous_diagonal;

        while x > previous_x && y > previous_y {
            edits.push(LineEdit::Equal);
            x -= 1;
            y -= 1;
        }
        if distance == 0 {
            break;
        }
        if x == previous_x {
            edits.push(LineEdit::Insert);
            y -= 1;
        } else {
            edits.push(LineEdit::Delete);
            x -= 1;
        }
    }
    edits.reverse();

    let mut hunks = Vec::new();
    let mut current: Option<wire::EditHunk> = None;
    let mut old_index = 0usize;
    let mut new_index = 0usize;
    for edit in edits {
        match edit {
            LineEdit::Equal => {
                if let Some(hunk) = current.take() {
                    hunks.push(hunk);
                }
                old_index += 1;
                new_index += 1;
            }
            LineEdit::Delete => {
                let hunk = current.get_or_insert_with(|| wire::EditHunk {
                    old_start: (old_index + 1).try_into().unwrap_or(u32::MAX),
                    old_lines: 0,
                    new_start: (new_index + 1).try_into().unwrap_or(u32::MAX),
                    new_lines: 0,
                    lines: Vec::new(),
                });
                hunk.old_lines = hunk.old_lines.saturating_add(1);
                hunk.lines.push(format!("-{}", old_lines[old_index]));
                old_index += 1;
            }
            LineEdit::Insert => {
                let hunk = current.get_or_insert_with(|| wire::EditHunk {
                    old_start: (old_index + 1).try_into().unwrap_or(u32::MAX),
                    old_lines: 0,
                    new_start: (new_index + 1).try_into().unwrap_or(u32::MAX),
                    new_lines: 0,
                    lines: Vec::new(),
                });
                hunk.new_lines = hunk.new_lines.saturating_add(1);
                hunk.lines.push(format!("+{}", new_lines[new_index]));
                new_index += 1;
            }
        }
    }
    if let Some(hunk) = current {
        hunks.push(hunk);
    }
    hunks
}

pub(super) fn line_change_counts(old_text: Option<&str>, new_text: &str) -> (u32, u32) {
    let new_lines = new_text.lines().collect::<Vec<_>>();
    let Some(old_text) = old_text else {
        return (new_lines.len().try_into().unwrap_or(u32::MAX), 0);
    };
    let old_lines = old_text.lines().collect::<Vec<_>>();
    let n = old_lines.len();
    let m = new_lines.len();
    if n == 0 {
        return (m.try_into().unwrap_or(u32::MAX), 0);
    }
    if m == 0 {
        return (0, n.try_into().unwrap_or(u32::MAX));
    }

    let max = n + m;
    let offset = max as isize + 1;
    let mut furthest = vec![0isize; max * 2 + 3];
    for distance in 0..=max {
        let d = distance as isize;
        let mut diagonal = -d;
        while diagonal <= d {
            let index = (offset + diagonal) as usize;
            let mut x =
                if diagonal == -d || (diagonal != d && furthest[index - 1] < furthest[index + 1]) {
                    furthest[index + 1]
                } else {
                    furthest[index - 1] + 1
                };
            let mut y = x - diagonal;
            while x < n as isize && y < m as isize && old_lines[x as usize] == new_lines[y as usize]
            {
                x += 1;
                y += 1;
            }
            furthest[index] = x;
            if x >= n as isize && y >= m as isize {
                let additions = (distance + m - n) / 2;
                let deletions = distance - additions;
                return (
                    additions.try_into().unwrap_or(u32::MAX),
                    deletions.try_into().unwrap_or(u32::MAX),
                );
            }
            diagonal += 2;
        }
    }
    (
        m.try_into().unwrap_or(u32::MAX),
        n.try_into().unwrap_or(u32::MAX),
    )
}
