//! Smith logic that runs off the actor loop (ADR 0027): the identity repo,
//! and the rules a Smith's fields must satisfy.

pub mod identity;

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
    fn a_charter_must_parse() {
        assert!(check_charter(CHARTER_TEMPLATE).is_ok());
        assert!(check_charter("habits: [").is_err());
    }
}
