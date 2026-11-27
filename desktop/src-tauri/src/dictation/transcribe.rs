use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use super::audio::{has_speech, WHISPER_RATE};

/// A loaded model is dropped after this long without use.
pub const IDLE_UNLOAD: Duration = Duration::from_secs(5 * 60);

struct Loaded {
    id: String,
    context: Arc<WhisperContext>,
    last_used: Instant,
}

/// Keeps at most one whisper model in memory and unloads it when idle.
#[derive(Default)]
pub struct ModelCache {
    loaded: Mutex<Option<Loaded>>,
    reaper: OnceLock<()>,
}

impl ModelCache {
    /// The context for `id`, loading it from `path` if another model (or none)
    /// is loaded.
    /// @param id catalog id of the model
    /// @param path model file on disk
    /// @returns a shared handle to the loaded context
    pub fn get(self: &Arc<Self>, id: &str, path: &Path) -> Result<Arc<WhisperContext>, String> {
        self.start_reaper();
        let mut loaded = self.loaded.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(current) = loaded.as_mut().filter(|current| current.id == id) {
            current.last_used = Instant::now();
            return Ok(current.context.clone());
        }
        *loaded = None;
        let path = path
            .to_str()
            .ok_or_else(|| "The model path is not valid UTF-8.".to_string())?;
        let context = WhisperContext::new_with_params(path, WhisperContextParameters::default())
            .map_err(|e| format!("Could not load the speech model: {e:?}"))?;
        let context = Arc::new(context);
        *loaded = Some(Loaded {
            id: id.to_string(),
            context: context.clone(),
            last_used: Instant::now(),
        });
        Ok(context)
    }

    /// Mark the loaded model as just used, so the idle timer restarts.
    pub fn touch(&self) {
        if let Some(current) = self
            .loaded
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_mut()
        {
            current.last_used = Instant::now();
        }
    }

    /// Drop the loaded model if it is `id`.
    /// @param id catalog id of the model being removed
    pub fn unload(&self, id: &str) {
        let mut loaded = self.loaded.lock().unwrap_or_else(|e| e.into_inner());
        if loaded.as_ref().is_some_and(|current| current.id == id) {
            *loaded = None;
        }
    }

    fn start_reaper(self: &Arc<Self>) {
        let cache = Arc::downgrade(self);
        self.reaper.get_or_init(move || {
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(30));
                let Some(cache) = cache.upgrade() else { return };
                let mut loaded = cache.loaded.lock().unwrap_or_else(|e| e.into_inner());
                if loaded
                    .as_ref()
                    .is_some_and(|current| current.last_used.elapsed() >= IDLE_UNLOAD)
                {
                    *loaded = None;
                }
            });
        });
    }
}

/// Turn the custom-words setting into whisper's initial prompt. Whisper copies
/// the spelling of words it sees in the prompt, which keeps English terms
/// intact inside Ukrainian or Russian speech.
/// @param custom_words one word or phrase per line or comma
/// @returns the prompt, empty when there are no words
pub fn initial_prompt(custom_words: &str) -> String {
    let words: Vec<&str> = custom_words
        .split([',', '\n'])
        .map(str::trim)
        .filter(|word| !word.is_empty())
        .collect();
    if words.is_empty() {
        String::new()
    } else {
        format!("{}.", words.join(", "))
    }
}

/// Strip whisper's non-speech annotations (`[BLANK_AUDIO]`, `(music)`) and
/// normalise whitespace.
/// @param raw concatenated segment text
/// @returns the text to insert
pub fn clean(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut depth = 0usize;
    for ch in raw.chars() {
        match ch {
            '[' | '(' | '*' if depth == 0 => depth = 1,
            ']' | ')' | '*' if depth == 1 => depth = 0,
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Transcribe 16 kHz mono audio.
/// @param context loaded whisper model
/// @param samples 16 kHz mono samples
/// @param language whisper language code, or `auto`
/// @param prompt initial prompt from [`initial_prompt`]
/// @returns the cleaned transcript, empty for silence
pub fn transcribe(
    context: &WhisperContext,
    samples: &[f32],
    language: &str,
    prompt: &str,
) -> Result<String, String> {
    if !has_speech(samples) {
        return Ok(String::new());
    }
    let mut audio = samples.to_vec();
    let min_len = WHISPER_RATE as usize + WHISPER_RATE as usize / 10;
    if audio.len() < min_len {
        audio.resize(min_len, 0.0);
    }
    let mut state = context
        .create_state()
        .map_err(|e| format!("Could not start transcription: {e:?}"))?;
    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: -1.0,
    });
    params.set_language(Some(language));
    params.set_translate(false);
    params.set_n_threads(threads());
    params.set_no_context(true);
    params.set_suppress_blank(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    if !prompt.is_empty() {
        params.set_initial_prompt(prompt);
    }
    state
        .full(params, &audio)
        .map_err(|e| format!("Transcription failed: {e:?}"))?;
    let segments = state
        .full_n_segments()
        .map_err(|e| format!("Transcription failed: {e:?}"))?;
    let mut text = String::new();
    for i in 0..segments {
        let segment = state
            .full_get_segment_text(i)
            .map_err(|e| format!("Transcription failed: {e:?}"))?;
        text.push_str(&segment);
        text.push(' ');
    }
    Ok(clean(&text))
}

fn threads() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get().min(8) as i32)
        .unwrap_or(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_from_custom_words() {
        assert_eq!(initial_prompt(""), "");
        assert_eq!(initial_prompt(" \n , "), "");
        assert_eq!(
            initial_prompt("Warpforge, Tauri\nPR, worktree "),
            "Warpforge, Tauri, PR, worktree."
        );
    }

    #[test]
    fn clean_strips_annotations() {
        assert_eq!(clean(" [BLANK_AUDIO] "), "");
        assert_eq!(
            clean(" Зроби commit (music)  і push "),
            "Зроби commit і push"
        );
        assert_eq!(clean("*sighs* Let's go"), "Let's go");
        assert_eq!(clean(" Привіт,  світ "), "Привіт, світ");
    }

    /// Synthesises the fixture with macOS `say` so no audio is checked in.
    fn spoken_fixture() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("wf-dictation-{}.wav", std::process::id()));
        let status = std::process::Command::new("say")
            .args(["-v", "Samantha", "--data-format=LEI16@16000", "-o"])
            .arg(&path)
            .arg("Open the settings page and commit the changes.")
            .status()
            .expect("`say` is needed to synthesise the fixture; set WARPFORGE_TEST_WAV instead");
        assert!(status.success());
        path
    }

    /// Needs a downloaded model: `WARPFORGE_TEST_WHISPER_MODEL=<path to .bin>
    /// cargo test -- --ignored transcribes_wav`. `WARPFORGE_TEST_WAV` and
    /// `WARPFORGE_TEST_EXPECT` swap in another recording and expected words.
    #[test]
    #[ignore]
    fn transcribes_wav_fixture() {
        let model = std::env::var("WARPFORGE_TEST_WHISPER_MODEL")
            .expect("set WARPFORGE_TEST_WHISPER_MODEL to a ggml model path");
        let (wav, default_expect) = match std::env::var("WARPFORGE_TEST_WAV") {
            Ok(path) => (std::path::PathBuf::from(path), ""),
            Err(_) => (spoken_fixture(), "settings commit"),
        };
        let mut reader = hound::WavReader::open(&wav).unwrap();
        let spec = reader.spec();
        let samples: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => reader.samples::<f32>().map(Result::unwrap).collect(),
            hound::SampleFormat::Int => {
                let scale = (1i64 << (spec.bits_per_sample - 1)) as f32;
                reader
                    .samples::<i32>()
                    .map(|s| s.unwrap() as f32 / scale)
                    .collect()
            }
        };
        let input =
            super::super::audio::to_whisper_input(&samples, spec.channels, spec.sample_rate);
        let context =
            WhisperContext::new_with_params(&model, WhisperContextParameters::default()).unwrap();
        let text = transcribe(&context, &input, "auto", "").unwrap();
        let expected =
            std::env::var("WARPFORGE_TEST_EXPECT").unwrap_or_else(|_| default_expect.into());
        assert!(!text.is_empty(), "empty transcript");
        for word in expected.split_whitespace() {
            assert!(
                text.to_lowercase().contains(&word.to_lowercase()),
                "missing {word:?} in {text:?}"
            );
        }
    }
}
