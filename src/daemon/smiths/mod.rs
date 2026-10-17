//! Smith logic that runs off the actor loop (ADR 0027): the identity repo,
//! and the rules a Smith's fields must satisfy.

pub mod identity;
pub mod presets;

/// The first Claude adapter release that reads `_meta.systemPrompt` on
/// `session/new` and `session/load`.
const META_SINCE: (u64, u64, u64) = (0, 91, 0);

/// Whether the `claude-agent-acp` on `PATH` takes `_meta.systemPrompt`: its
/// package version is at least [`META_SINCE`]. Blocks on the filesystem.
/// @returns false when it cannot tell
pub fn claude_adapter_reads_meta() -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path)
        .map(|dir| dir.join("claude-agent-acp"))
        .find(|bin| bin.exists())
        .and_then(|bin| std::fs::canonicalize(bin).ok())
        .and_then(|bin| adapter_version(&bin))
        .is_some_and(|version| version >= META_SINCE)
}

/// The version in the nearest `package.json` above the adapter's script.
fn adapter_version(script: &std::path::Path) -> Option<(u64, u64, u64)> {
    script.ancestors().skip(1).find_map(|dir| {
        let text = std::fs::read_to_string(dir.join("package.json")).ok()?;
        let manifest: serde_json::Value = serde_json::from_str(&text).ok()?;
        if manifest["name"] != "@agentclientprotocol/claude-agent-acp" {
            return None;
        }
        parse_version(manifest["version"].as_str()?)
    })
}

fn parse_version(text: &str) -> Option<(u64, u64, u64)> {
    let mut parts = text.split(['.', '-']).map(|p| p.parse::<u64>().ok());
    Some((parts.next()??, parts.next()??, parts.next()??))
}

/// Where a deleted Smith's identity repo is moved, under the smiths root.
pub const DELETED_DIR: &str = ".deleted";

/// A Smith's name is what `@Name` resolves, so it is one word.
/// @param name the proposed name
/// @returns why it cannot be a name
pub fn check_name(name: &str) -> Result<(), String> {
    let valid = name.chars().next().is_some_and(|c| c.is_alphabetic())
        && name.chars().count() <= 32
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_');
    if valid {
        Ok(())
    } else {
        Err(format!(
            "'{name}' cannot be a Smith's name: one word of letters, digits, '-' or '_', \
             starting with a letter, at most 32 characters"
        ))
    }
}

/// How many colours a client's palette has; a Smith's `color` indexes it.
pub const PALETTE: u8 = 6;

/// A Smith's colour before anyone picks one: stable for its id. The desktop
/// derived the same value before the daemon stored it.
/// @param id the Smith's id
/// @returns a palette index
pub fn default_color(id: &str) -> u8 {
    let hash = id
        .chars()
        .fold(0u32, |hash, c| hash.wrapping_mul(31).wrapping_add(c as u32));
    (hash % PALETTE as u32) as u8
}

/// @param color a proposed palette index
/// @returns why it is not one
pub fn check_color(color: u8) -> Result<(), String> {
    (color < PALETTE)
        .then_some(())
        .ok_or_else(|| format!("a Smith's colour is a palette index below {PALETTE}"))
}

/// The soul a new Smith starts from when none is given.
/// @param name the Smith's name
/// @returns the template
pub fn soul_template(name: &str) -> String {
    format!(
        "# {name}\n\n\
         ## Voice\n\nPlain and direct.\n\n\
         ## Decision rules\n\n- Ask before anything you are unsure about.\n\n\
         ## Refusals\n\n- Nothing beyond the constitution yet.\n"
    )
}

/// The charter a new Smith starts from when none is given.
pub const CHARTER_TEMPLATE: &str =
    "# What this Smith watches. Habits and triggers come later.\nhabits: []\n";

/// A charter must be YAML, so the user's editor mistakes surface on save.
/// @param charter the proposed text
/// @returns the parse error
pub fn check_charter(charter: &str) -> Result<(), String> {
    serde_yaml::from_str::<serde_yaml::Value>(charter)
        .map(|_| ())
        .map_err(|e| format!("charter.yaml is not valid YAML: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_one_mentionable_word() {
        assert!(check_name("Ada").is_ok());
        assert!(check_name("ci-keeper_2").is_ok());
        for bad in ["", "2pac", "Ada Lovelace", "a·b", "@Ada", &"x".repeat(33)] {
            assert!(check_name(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn the_adapter_version_is_read_from_its_package() {
        let dir = tempfile::tempdir().unwrap();
        let dist = dir.path().join("dist");
        std::fs::create_dir_all(&dist).unwrap();
        let manifest = |version: &str| {
            format!(r#"{{"name":"@agentclientprotocol/claude-agent-acp","version":"{version}"}}"#)
        };
        std::fs::write(dir.path().join("package.json"), manifest("0.91.0")).unwrap();
        assert_eq!(adapter_version(&dist.join("index.js")), Some((0, 91, 0)));
        std::fs::write(dir.path().join("package.json"), manifest("0.90.3-beta")).unwrap();
        assert!(adapter_version(&dist.join("index.js")).unwrap() < META_SINCE);
        assert_eq!(parse_version("1.2"), None);
    }

    #[test]
    fn a_colour_is_a_stable_palette_index() {
        assert_eq!(default_color("sm_1"), default_color("sm_1"));
        assert!((0..100).all(|i| default_color(&format!("sm_{i}")) < PALETTE));
        assert!(check_color(PALETTE - 1).is_ok());
        assert!(check_color(PALETTE).is_err());
    }

    #[test]
    fn a_charter_must_parse() {
        assert!(check_charter(CHARTER_TEMPLATE).is_ok());
        assert!(check_charter("habits: [").is_err());
    }
}
