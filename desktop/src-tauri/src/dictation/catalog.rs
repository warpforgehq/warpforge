use std::path::{Path, PathBuf};

use serde::Serialize;

/// A downloadable whisper.cpp model, pinned by size and checksum.
#[derive(Debug, Clone, Copy)]
pub struct ModelEntry {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub file: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub size: u64,
}

pub const DEFAULT_MODEL: &str = "large-v3-turbo-q5_0";

pub const CATALOG: &[ModelEntry] = &[
    ModelEntry {
        id: "large-v3-turbo-q5_0",
        label: "Large v3 Turbo",
        description: "Best accuracy for mixed-language speech. Recommended.",
        file: "ggml-large-v3-turbo-q5_0.bin",
        url:
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        size: 574_041_195,
    },
    ModelEntry {
        id: "small-q5_1",
        label: "Small",
        description: "Faster and lighter, less accurate on mixed languages.",
        file: "ggml-small-q5_1.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin",
        sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb",
        size: 190_085_487,
    },
];

/// Look a model up by id.
/// @param id catalog id, e.g. `large-v3-turbo-q5_0`
/// @returns the entry, or `None` for an unknown id
pub fn find(id: &str) -> Option<&'static ModelEntry> {
    CATALOG.iter().find(|entry| entry.id == id)
}

/// `~/.warpforge/models`, where downloaded models live.
/// @returns the directory path; it may not exist yet
pub fn models_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|home| home.join(".warpforge").join("models"))
        .ok_or_else(|| "Could not find the home directory.".to_string())
}

/// What the UI shows for one catalog model.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
    pub size_bytes: u64,
    pub installed: bool,
    pub is_default: bool,
}

/// Whether a model's final file is present at its pinned size. The checksum
/// is verified once, at download time.
/// @param dir models directory
/// @param entry catalog entry to check
/// @returns true when the file exists with the expected size
pub fn is_installed(dir: &Path, entry: &ModelEntry) -> bool {
    std::fs::metadata(dir.join(entry.file)).is_ok_and(|meta| meta.len() == entry.size)
}

/// Status of every catalog model in `dir`.
/// @param dir models directory
/// @returns one status per catalog entry, in catalog order
pub fn statuses(dir: &Path) -> Vec<ModelStatus> {
    CATALOG
        .iter()
        .map(|entry| ModelStatus {
            id: entry.id,
            label: entry.label,
            description: entry.description,
            size_bytes: entry.size,
            installed: is_installed(dir, entry),
            is_default: entry.id == DEFAULT_MODEL,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_model_is_in_catalog() {
        assert!(find(DEFAULT_MODEL).is_some());
    }

    #[test]
    fn catalog_entries_are_pinned_and_multilingual() {
        let mut ids = std::collections::HashSet::new();
        for entry in CATALOG {
            assert!(ids.insert(entry.id), "duplicate id {}", entry.id);
            assert!(
                !entry.file.contains(".en"),
                "{} is English-only",
                entry.file
            );
            assert!(entry
                .url
                .starts_with("https://huggingface.co/ggerganov/whisper.cpp/"));
            assert!(entry.url.ends_with(entry.file));
            assert_eq!(entry.sha256.len(), 64);
            assert!(entry.sha256.chars().all(|c| c.is_ascii_hexdigit()));
            assert!(entry.size > 0);
        }
    }

    #[test]
    fn installed_requires_exact_size() {
        let dir = crate::dictation::test_dir();
        let entry = ModelEntry {
            size: 4,
            file: "m.bin",
            ..CATALOG[0]
        };
        assert!(!is_installed(&dir, &entry));
        std::fs::write(dir.join("m.bin"), b"abc").unwrap();
        assert!(!is_installed(&dir, &entry));
        std::fs::write(dir.join("m.bin"), b"abcd").unwrap();
        assert!(is_installed(&dir, &entry));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
