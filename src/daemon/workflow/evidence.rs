//! Screenshots a verify stage keeps as evidence, one directory per pipeline
//! under `~/.warpforge/evidence/<parent task id>/`. Outside the project on
//! purpose: a file in the checkout would show up in the diff under review.

use std::path::PathBuf;

use base64::Engine;
use warpforge_protocol as wire;

fn root() -> PathBuf {
    // Tests never write into the user's home.
    if cfg!(test) {
        return std::env::temp_dir().join(format!("warpforge-evidence-{}", std::process::id()));
    }
    crate::registry::warpforge_dir().join("evidence")
}

/// Task ids and evidence names are single path components from our own
/// generators; anything else is refused rather than joined onto a path.
pub(crate) fn is_plain_component(part: &str) -> bool {
    !part.is_empty()
        && part != "."
        && part != ".."
        && part
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

/// The directory holding one pipeline's evidence.
/// @param parent_id the pipeline's parent task id
/// @returns the directory, or `None` for an id that is not a plain name
pub fn run_dir(parent_id: &str) -> Option<PathBuf> {
    is_plain_component(parent_id).then(|| root().join(parent_id))
}

/// The file name for the `seq`-th screenshot of a run.
/// @param seq 1-based sequence number within the run
/// @param mime the image's MIME type as the browser reported it
/// @returns e.g. `shot-3.png`
pub fn file_name(seq: usize, mime: &str) -> String {
    let ext = match mime {
        "image/png" => "png",
        _ => "jpg",
    };
    format!("shot-{seq}.{ext}")
}

/// Decode a base64 screenshot and write it.
/// @param path where to write, from a kept evidence entry
/// @param data_base64 the image bytes as the browser returned them
/// @returns why it was not written
pub fn write(path: &str, data_base64: &str) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_base64.trim())
        .map_err(|e| format!("screenshot is not base64: {e}"))?;
    let path = std::path::Path::new(path);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("creating {}: {e}", dir.display()))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("writing {}: {e}", path.display()))
}

/// Read one evidence image back for display.
/// @param parent_id the pipeline's parent task id
/// @param name the evidence name, e.g. `shot-3.png`
/// @returns the image, or why it cannot be read
pub fn read(parent_id: &str, name: &str) -> Result<wire::WorkflowEvidenceImage, String> {
    let dir = run_dir(parent_id).ok_or("not a task id")?;
    if !is_plain_component(name) {
        return Err("not an evidence name".into());
    }
    let bytes =
        std::fs::read(dir.join(name)).map_err(|e| format!("evidence {name} unavailable: {e}"))?;
    let content_type = if name.ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    };
    Ok(wire::WorkflowEvidenceImage {
        content_type: content_type.into(),
        data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

/// Delete a pipeline's evidence along with its task. Best effort.
/// @param parent_id the pipeline's parent task id
pub fn remove_run(parent_id: &str) {
    if let Some(dir) = run_dir(parent_id) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evidence_round_trips_and_refuses_paths() {
        let parent = "t_evidence_roundtrip";
        let path = run_dir(parent).unwrap().join(file_name(1, "image/png"));
        write(path.to_str().unwrap(), "AAEC").unwrap();
        let image = read(parent, "shot-1.png").unwrap();
        assert_eq!(image.content_type, "image/png");
        assert_eq!(image.data_base64, "AAEC");
        assert_eq!(file_name(2, "image/jpeg"), "shot-2.jpg");

        assert!(read(parent, "../shot-1.png").is_err());
        assert!(read("..", "shot-1.png").is_err());
        assert!(read("a/b", "shot-1.png").is_err());
        assert!(run_dir("").is_none());
        assert!(write(path.to_str().unwrap(), "not base64!").is_err());

        remove_run(parent);
        assert!(read(parent, "shot-1.png").is_err());
        // Only succeeds once no other test holds evidence in this process.
        let _ = std::fs::remove_dir(root());
    }
}
