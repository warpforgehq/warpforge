use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

use super::capture::{self, Event};
use super::catalog::{self, ModelStatus};
use super::{audio, download, ensure_microphone_allowed, transcribe, Dictation};

const NO_AUDIO: &str = "The microphone sent no sound. Allow Warpforge in System Settings → \
                        Privacy & Security → Microphone, then try again.";

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("Dictation worker failed: {e}"))?
}

/// The model catalog with what is installed.
/// @returns one entry per catalog model
#[tauri::command]
pub fn dictation_models() -> Result<Vec<ModelStatus>, String> {
    Ok(catalog::statuses(&catalog::models_dir()?))
}

/// Input device names for the microphone setting.
/// @returns device names, system default first
#[tauri::command]
pub async fn dictation_devices() -> Result<Vec<String>, String> {
    blocking(|| Ok(capture::input_devices())).await
}

/// Start recording. Emits `dictation:level` while recording and
/// `dictation:limit` if the length cap stops it.
/// @param device input device name; `None` uses the system default
/// @returns once the microphone is open
#[tauri::command]
pub async fn dictation_start(app: AppHandle, device: Option<String>) -> Result<(), String> {
    ensure_microphone_allowed()?;
    if app.state::<Dictation>().recording_slot().is_some() {
        return Err("Already recording.".into());
    }
    let emitter = app.clone();
    let recording = blocking(move || {
        capture::start(device, move |event| match event {
            Event::Level { level, elapsed } => {
                let _ = emitter.emit(
                    "dictation:level",
                    serde_json::json!({ "level": level, "elapsedMs": elapsed.as_millis() as u64 }),
                );
            }
            Event::LimitReached => {
                let _ = emitter.emit("dictation:limit", ());
            }
        })
    })
    .await?;
    let duplicate = {
        let state = app.state::<Dictation>();
        let mut slot = state.recording_slot();
        if slot.is_some() {
            Some(recording)
        } else {
            *slot = Some(recording);
            None
        }
    };
    if let Some(recording) = duplicate {
        blocking(move || recording.finish().map(drop)).await?;
        return Err("Already recording.".into());
    }
    Ok(())
}

/// Stop recording and transcribe it.
/// @param model catalog id of the model to use
/// @param language whisper language code, or `auto`
/// @param custom_words words to bias spelling toward, comma or newline separated
/// @returns the transcript; empty when nothing was said
#[tauri::command]
pub async fn dictation_stop(
    state: State<'_, Dictation>,
    model: String,
    language: String,
    custom_words: String,
) -> Result<String, String> {
    let recording = state
        .recording_slot()
        .take()
        .ok_or_else(|| "Not recording.".to_string())?;
    let models = state.models.clone();
    blocking(move || {
        let captured = recording.finish()?;
        if captured.samples.is_empty() {
            return Ok(String::new());
        }
        if captured.samples.iter().all(|s| *s == 0.0) {
            return Err(NO_AUDIO.into());
        }
        let entry = catalog::find(&model).ok_or_else(|| format!("Unknown model {model}."))?;
        let dir = catalog::models_dir()?;
        if !catalog::is_installed(&dir, entry) {
            return Err(format!("The {} model is not downloaded.", entry.label));
        }
        let input = audio::to_whisper_input(&captured.samples, captured.channels, captured.rate);
        let context = models.get(entry.id, &dir.join(entry.file))?;
        let prompt = transcribe::initial_prompt(&custom_words);
        let text = transcribe::transcribe(&context, &input, &language, &prompt);
        models.touch();
        text
    })
    .await
}

/// Stop recording and throw the audio away.
#[tauri::command]
pub async fn dictation_cancel(state: State<'_, Dictation>) -> Result<(), String> {
    let recording = state.recording_slot().take();
    if let Some(recording) = recording {
        blocking(move || recording.finish().map(drop)).await?;
    }
    Ok(())
}

/// Download a catalog model, resuming a partial download. Emits
/// `dictation:progress` while it runs.
/// @param id catalog id
/// @returns once the model is verified and installed
#[tauri::command]
pub async fn dictation_download(app: AppHandle, id: String) -> Result<(), String> {
    let entry = catalog::find(&id).ok_or_else(|| format!("Unknown model {id}."))?;
    let dir = catalog::models_dir()?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let state = app.state::<Dictation>();
        let mut downloads = state.downloads.lock().unwrap_or_else(|e| e.into_inner());
        if downloads.contains_key(entry.id) {
            return Err(format!("{} is already downloading.", entry.label));
        }
        downloads.insert(entry.id, cancel.clone());
    }
    let emitter = app.clone();
    let result = blocking(move || {
        download::download(&dir, entry, &cancel, |progress| {
            let _ = emitter.emit("dictation:progress", progress);
        })
        .map(drop)
    })
    .await;
    app.state::<Dictation>()
        .downloads
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(entry.id);
    result
}

/// Delete a model, cancelling its download if one is running.
/// @param id catalog id
#[tauri::command]
pub fn dictation_delete_model(state: State<'_, Dictation>, id: String) -> Result<(), String> {
    let entry = catalog::find(&id).ok_or_else(|| format!("Unknown model {id}."))?;
    if let Some(cancel) = state
        .downloads
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(entry.id)
    {
        cancel.store(true, Ordering::SeqCst);
    }
    state.models.unload(entry.id);
    download::delete(&catalog::models_dir()?, entry)
}

impl Dictation {
    fn recording_slot(&self) -> std::sync::MutexGuard<'_, Option<capture::Recording>> {
        self.recording.lock().unwrap_or_else(|e| e.into_inner())
    }
}
