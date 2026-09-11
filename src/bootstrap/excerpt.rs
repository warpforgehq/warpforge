use std::collections::BTreeSet;

pub(super) fn redact_env_content(content: &str) -> String {
    let mut output = Vec::new();
    let mut inside_private_key = false;

    for line in content.lines() {
        if inside_private_key {
            if line.contains("END PRIVATE KEY") {
                inside_private_key = false;
            }
            continue;
        }

        let Some((key, separator, value)) = split_env_assignment(line) else {
            if line.contains("BEGIN PRIVATE KEY") {
                output.push("<redacted private key>".to_string());
                inside_private_key = !line.contains("END PRIVATE KEY");
            } else {
                output.push(line.to_string());
            }
            continue;
        };
        let upper = key.to_ascii_uppercase();
        if [
            "PASSWORD",
            "SECRET",
            "TOKEN",
            "PRIVATE_KEY",
            "ACCESS_KEY",
            "API_KEY",
        ]
        .iter()
        .any(|marker| upper.contains(marker))
        {
            output.push(format!("{key}{separator}<redacted>"));
            inside_private_key = value.contains("BEGIN PRIVATE KEY")
                && !value.contains("END PRIVATE KEY")
                && !value.contains("\\n");
            continue;
        }
        if let (Some(scheme), Some(at)) = (value.find("://"), value.rfind('@')) {
            if at > scheme + 3 {
                output.push(format!(
                    "{key}{separator}{}<redacted>@{}",
                    &value[..scheme + 3],
                    &value[at + 1..]
                ));
                continue;
            }
        }
        output.push(line.to_string());
    }

    output.join("\n")
}

pub(super) fn focused_env_excerpt(content: &str) -> String {
    redact_env_content(content)
        .lines()
        .filter(|line| {
            let Some((key, _, value)) = split_env_assignment(line) else {
                return false;
            };
            let upper_key = key.to_ascii_uppercase();
            let lower_value = value.to_ascii_lowercase();
            upper_key.contains("PORT")
                || lower_value.contains("localhost")
                || lower_value.contains("127.0.0.1")
                || lower_value.contains("0.0.0.0")
                || ((upper_key.ends_with("_URL") || upper_key.ends_with("_ENDPOINT"))
                    && value.starts_with('/'))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn split_env_assignment(line: &str) -> Option<(&str, char, &str)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    let separator_index = match (trimmed.find('='), trimmed.find(':')) {
        (Some(equal), Some(colon)) => equal.min(colon),
        (Some(equal), None) => equal,
        (None, Some(colon)) => colon,
        (None, None) => return None,
    };
    let key = trimmed[..separator_index].trim();
    if key.is_empty()
        || !key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        return None;
    }
    let separator = trimmed.as_bytes()[separator_index] as char;
    Some((key, separator, trimmed[separator_index + 1..].trim()))
}

pub(super) fn focused_source_excerpt(content: &str) -> String {
    let lines: Vec<_> = content.lines().collect();
    let mut selected = BTreeSet::new();
    for (index, line) in lines.iter().enumerate() {
        let lower = line.to_ascii_lowercase();
        let port_evidence = lower.contains("process.env.port")
            || lower.contains("import.meta.env.port")
            || lower.contains("const port")
            || lower.contains("let port")
            || lower.contains("var port")
            || lower.contains("port:")
            || lower.contains("port =")
            || lower.contains("--port")
            || lower.contains("server.port")
            || lower.contains("${port}")
            || lower.contains("\"port\"")
            || lower.contains("'port'");
        let readiness_evidence = (lower.contains("logger.") || lower.contains("console.log"))
            && (lower.contains("listen") || lower.contains("ready") || lower.contains("started"));
        if port_evidence || lower.contains(".listen(") || readiness_evidence {
            let start = index.saturating_sub(2);
            let end = (index + 2).min(lines.len().saturating_sub(1));
            selected.extend(start..=end);
        }
    }
    if selected.is_empty() {
        return truncate_file_content(content, 3_000);
    }

    let mut out = String::new();
    let mut previous = None;
    for index in selected {
        if previous.is_some_and(|previous| index > previous + 1) {
            out.push_str("...\n");
        }
        out.push_str(&format!("{}: {}\n", index + 1, lines[index]));
        previous = Some(index);
    }
    out
}

pub(super) fn focused_helm_excerpt(content: &str) -> String {
    let lines: Vec<_> = content.lines().collect();
    let mut out = String::new();
    let mut index = 0;
    while index < lines.len() {
        if !lines[index].starts_with("  - name:") {
            index += 1;
            continue;
        }

        out.push_str(lines[index].trim_start());
        out.push('\n');
        index += 1;
        let mut inside_needs = false;
        while index < lines.len() && !lines[index].starts_with("  - name:") {
            let trimmed = lines[index].trim_start();
            let indentation = lines[index].len() - trimmed.len();
            if indentation <= 4 && !trimmed.is_empty() && !trimmed.starts_with("needs:") {
                inside_needs = false;
            }
            if trimmed.starts_with("needs:") {
                inside_needs = true;
            }
            if trimmed.starts_with("namespace:")
                || trimmed.starts_with("chart:")
                || trimmed.starts_with("needs:")
                || (inside_needs && indentation >= 6 && trimmed.starts_with("- "))
            {
                out.push_str("  ");
                out.push_str(trimmed);
                out.push('\n');
            }
            index += 1;
        }
    }

    if out.is_empty() {
        truncate_file_content(content, 3_000)
    } else {
        out
    }
}

pub(super) fn yaml_scalar_or_sequence(value: &serde_yaml::Value) -> String {
    if let Some(value) = value.as_str() {
        value.to_string()
    } else if let Some(values) = value.as_sequence() {
        values
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        String::new()
    }
}

pub(super) fn yaml_keys_or_sequence(value: &serde_yaml::Value) -> String {
    if let Some(values) = value.as_sequence() {
        values
            .iter()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    } else if let Some(values) = value.as_mapping() {
        values
            .keys()
            .filter_map(|value| value.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    } else {
        String::new()
    }
}

pub(super) fn truncate_file_content(content: &str, max_chars: usize) -> String {
    if content.len() <= max_chars {
        content.to_string()
    } else {
        let boundary = (0..=max_chars)
            .rev()
            .find(|index| content.is_char_boundary(*index))
            .unwrap_or(0);
        format!(
            "{}... ({} bytes total)",
            &content[..boundary],
            content.len()
        )
    }
}
