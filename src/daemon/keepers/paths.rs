use glob::Pattern;

/// Whether a change touches a keeper's `paths`. Empty `paths` match
/// everything; a leading `!` excludes; with only exclusions, every other
/// path is included.
/// @param paths the keeper's globs, already validated
/// @param files the paths the change touched, relative to the repository
/// @returns whether at least one file is included and not excluded
pub fn touches(paths: &[String], files: &[String]) -> bool {
    if paths.is_empty() {
        return true;
    }
    let mut include = Vec::new();
    let mut exclude = Vec::new();
    for path in paths {
        match path.strip_prefix('!') {
            Some(glob) => exclude.extend(Pattern::new(glob).ok()),
            None => include.extend(Pattern::new(path).ok()),
        }
    }
    files.iter().any(|file| {
        (include.is_empty() || include.iter().any(|p| p.matches(file)))
            && !exclude.iter().any(|p| p.matches(file))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn includes_and_exclusions() {
        let paths = s(&["src/**", "!**/*.md"]);
        assert!(touches(&paths, &s(&["src/lib.rs"])));
        assert!(!touches(&paths, &s(&["src/README.md"])));
        assert!(!touches(&paths, &s(&["docs/a.rs"])));
        assert!(touches(&paths, &s(&["docs/a.md", "src/x/y.rs"])));
        assert!(touches(&s(&["!**/*.md"]), &s(&["Cargo.toml"])));
        assert!(!touches(&s(&["!**/*.md"]), &s(&["a.md"])));
        assert!(touches(&[], &s(&["anything"])));
        assert!(!touches(&paths, &[]));
    }
}
