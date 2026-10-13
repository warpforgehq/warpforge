//! `~/.warpforge/config.yaml`: the daemon's settings file, one top-level
//! section per subsystem (`history:`, `memory:`, `claude:`).
//!
//! Every reader is tolerant: a missing file, a missing section or a section of
//! the wrong shape yields that section's defaults, never an error — a typo in
//! one section must not take another subsystem's settings down with it.
//! Writers rewrite a single section and keep every other key.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::de::DeserializeOwned;
use serde_yaml::{Mapping, Value};

pub fn path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".warpforge")
        .join("config.yaml")
}

/// One section of the settings file, or its defaults.
pub fn load_section<T: DeserializeOwned + Default>(key: &str) -> T {
    load_section_from(&path(), key)
}

pub(crate) fn load_section_from<T: DeserializeOwned + Default>(path: &Path, key: &str) -> T {
    std::fs::read_to_string(path)
        .map(|raw| parse_section(&raw, key))
        .unwrap_or_default()
}

/// `key`'s section out of the file's text, or its defaults.
pub(crate) fn parse_section<T: DeserializeOwned + Default>(raw: &str, key: &str) -> T {
    serde_yaml::from_str::<Value>(raw)
        .ok()
        .and_then(|root| root.get(key).cloned())
        .and_then(|section| serde_yaml::from_value(section).ok())
        .unwrap_or_default()
}

/// Rewrite one section in place: `edit` receives the section's mapping
/// (created if absent) and may change any key in it.
pub fn update_section(key: &str, edit: impl FnOnce(&mut Mapping)) -> Result<()> {
    update_section_at(&path(), key, edit)
}

pub(crate) fn update_section_at(
    path: &Path,
    key: &str,
    edit: impl FnOnce(&mut Mapping),
) -> Result<()> {
    // A file we cannot parse is refused, not replaced: rewriting it from an
    // empty mapping would silently drop every other section — including
    // hand-written ones like `claude:` — over one typo.
    let mut root: Value = match std::fs::read_to_string(path) {
        Ok(raw) => match serde_yaml::from_str(&raw) {
            Ok(Value::Null) => Value::Mapping(Mapping::new()),
            Ok(root) => root,
            Err(error) => anyhow::bail!(
                "{} is not valid YAML, so it was left untouched — fix it and try again: {error}",
                path.display()
            ),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Value::Mapping(Mapping::new())
        }
        Err(error) => anyhow::bail!("reading {}: {error}", path.display()),
    };
    let root_map = root
        .as_mapping_mut()
        .ok_or_else(|| anyhow::anyhow!("config.yaml is not a mapping"))?;
    if !root_map.contains_key(key) {
        root_map.insert(Value::String(key.into()), Value::Mapping(Mapping::new()));
    }
    let section = root_map
        .get_mut(key)
        .and_then(Value::as_mapping_mut)
        .ok_or_else(|| anyhow::anyhow!("config.yaml '{key}' is not a mapping"))?;
    edit(section);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    std::fs::write(path, serde_yaml::to_string(&root)?)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Default, Deserialize, PartialEq)]
    struct Section {
        #[serde(default)]
        days: u32,
    }

    #[test]
    fn a_bad_section_falls_back_without_touching_the_others() {
        let raw = "history:\n  days: 7\nmemory:\n  days: not-a-number\n";
        assert_eq!(
            parse_section::<Section>(raw, "history"),
            Section { days: 7 }
        );
        assert_eq!(parse_section::<Section>(raw, "memory"), Section::default());
        assert_eq!(parse_section::<Section>(raw, "claude"), Section::default());
        assert_eq!(
            parse_section::<Section>("history:\n", "history"),
            Section::default()
        );
        assert_eq!(
            parse_section::<Section>(": : :", "history"),
            Section::default()
        );
        assert_eq!(
            parse_section::<Section>("- a\n- b\n", "history"),
            Section::default()
        );
    }

    #[test]
    fn missing_file_yields_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let section: Section = load_section_from(&dir.path().join("config.yaml"), "history");
        assert_eq!(section, Section::default());
    }

    #[test]
    fn updating_a_section_keeps_every_other_key() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("config.yaml");
        update_section_at(&path, "history", |s| {
            s.insert("days".into(), 3.into());
        })
        .unwrap();
        std::fs::write(
            &path,
            format!(
                "{}claude:\n  config_dir: ~/.claude-work\n",
                std::fs::read_to_string(&path).unwrap()
            ),
        )
        .unwrap();
        update_section_at(&path, "history", |s| {
            s.insert("days".into(), 9.into());
        })
        .unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            parse_section::<Section>(&raw, "history"),
            Section { days: 9 }
        );
        assert!(raw.contains("config_dir: ~/.claude-work"), "{raw}");
    }

    #[test]
    fn an_unparsable_file_is_refused_not_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.yaml");
        let broken = "claude:\n  config_dir: ~/.claude-work\n\thistory: [\n";
        std::fs::write(&path, broken).unwrap();
        let err = update_section_at(&path, "history", |s| {
            s.insert("days".into(), 1.into());
        })
        .unwrap_err();
        assert!(err.to_string().contains("not valid YAML"), "{err}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), broken);
    }

    #[test]
    fn an_empty_file_is_written_like_a_missing_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.yaml");
        for initial in ["", "# just a comment\n", "~\n"] {
            std::fs::write(&path, initial).unwrap();
            update_section_at(&path, "history", |s| {
                s.insert("days".into(), 2.into());
            })
            .unwrap();
            let raw = std::fs::read_to_string(&path).unwrap();
            assert_eq!(
                parse_section::<Section>(&raw, "history"),
                Section { days: 2 },
                "{initial:?}"
            );
        }
    }

    #[test]
    fn a_section_that_is_not_a_mapping_is_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.yaml");
        std::fs::write(&path, "history: 5\n").unwrap();
        assert!(update_section_at(&path, "history", |_| {}).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "history: 5\n");
    }
}
