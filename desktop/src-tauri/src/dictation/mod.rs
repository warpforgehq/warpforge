mod audio;
mod capture;
mod catalog;
pub mod commands;
mod download;
mod transcribe;

use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

/// Dictation state owned by the Tauri app.
#[derive(Default)]
pub struct Dictation {
    recording: Mutex<Option<capture::Recording>>,
    models: Arc<transcribe::ModelCache>,
    downloads: Mutex<HashMap<&'static str, Arc<AtomicBool>>>,
}

/// Refuse to open the microphone where macOS would kill the app for it: an
/// unbundled `tauri dev` binary has no usage description of its own.
fn ensure_microphone_allowed() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let unbundled = mac_usernotifications::check_bundle().is_err();
        if unbundled && std::env::var_os("WARPFORGE_DICTATION_UNBUNDLED").is_none() {
            return Err(
                "Voice input needs the installed Warpforge app: macOS only grants \
                        microphone access to a bundled app. For development, set \
                        WARPFORGE_DICTATION_UNBUNDLED=1 to try anyway."
                    .into(),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn test_dir() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!(
        "wf-dictation-test-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}
