use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};

/// Longest recording; capture stops on its own here.
pub const MAX_RECORDING: Duration = Duration::from_secs(5 * 60);
const LEVEL_INTERVAL: Duration = Duration::from_millis(50);

/// Raw audio as the device delivered it.
pub struct Captured {
    pub samples: Vec<f32>,
    pub channels: u16,
    pub rate: u32,
}

/// What the capture thread reports while it runs.
pub enum Event {
    /// Peak level of the last interval (0..=1) and time since start.
    Level { level: f32, elapsed: Duration },
    /// [`MAX_RECORDING`] was reached and the microphone was released.
    LimitReached,
}

/// A running capture. The cpal stream is not `Send` on macOS, so it lives on
/// its own thread and this handle only talks to that thread.
pub struct Recording {
    stop: mpsc::Sender<()>,
    thread: JoinHandle<Captured>,
}

impl Recording {
    /// Stop capturing and hand back everything recorded.
    /// @returns the captured audio
    pub fn finish(self) -> Result<Captured, String> {
        let _ = self.stop.send(());
        self.thread
            .join()
            .map_err(|_| "The recording thread crashed.".to_string())
    }
}

/// Names of the available input devices.
/// @returns device names, default device first
pub fn input_devices() -> Vec<String> {
    let host = cpal::default_host();
    let default = host.default_input_device().and_then(|d| d.name().ok());
    let mut names: Vec<String> = host
        .input_devices()
        .map(|devices| devices.filter_map(|d| d.name().ok()).collect())
        .unwrap_or_default();
    if let Some(default) = default {
        names.retain(|name| name != &default);
        names.insert(0, default);
    }
    names
}

fn pick_device(name: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if let Some(name) = name {
        let found = host
            .input_devices()
            .ok()
            .and_then(|mut devices| devices.find(|d| d.name().ok().as_deref() == Some(name)));
        if let Some(device) = found {
            return Ok(device);
        }
    }
    host.default_input_device()
        .ok_or_else(|| "No microphone found.".to_string())
}

/// Open the microphone and start recording on a dedicated thread.
/// @param device input device name; `None` or an unknown name uses the default
/// @param on_event receives level updates and the limit notice
/// @returns a handle to stop the recording, once the stream is running
pub fn start(
    device: Option<String>,
    on_event: impl Fn(Event) + Send + 'static,
) -> Result<Recording, String> {
    let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<(), String>>(1);
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let thread = std::thread::Builder::new()
        .name("dictation-capture".into())
        .spawn(move || {
            let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
            let peak = Arc::new(AtomicU32::new(0));
            let opened = open_stream(device.as_deref(), buffer.clone(), peak.clone());
            let (stream, channels, rate) = match opened {
                Ok(opened) => opened,
                Err(error) => {
                    let _ = ready_tx.send(Err(error));
                    return Captured {
                        samples: Vec::new(),
                        channels: 1,
                        rate: 16_000,
                    };
                }
            };
            let _ = ready_tx.send(Ok(()));
            let started = Instant::now();
            let mut stream = Some(stream);
            loop {
                match stop_rx.recv_timeout(LEVEL_INTERVAL) {
                    Ok(()) | Err(RecvTimeoutError::Disconnected) => break,
                    Err(RecvTimeoutError::Timeout) => {}
                }
                if stream.is_none() {
                    continue;
                }
                let level = f32::from_bits(peak.swap(0, Ordering::Relaxed));
                let elapsed = started.elapsed();
                on_event(Event::Level { level, elapsed });
                if elapsed >= MAX_RECORDING {
                    stream = None;
                    on_event(Event::LimitReached);
                }
            }
            drop(stream);
            let samples = std::mem::take(&mut *buffer.lock().unwrap_or_else(|e| e.into_inner()));
            Captured {
                samples,
                channels,
                rate,
            }
        })
        .map_err(|e| format!("Could not start recording: {e}"))?;
    match ready_rx.recv() {
        Ok(Ok(())) => Ok(Recording {
            stop: stop_tx,
            thread,
        }),
        Ok(Err(error)) => {
            let _ = thread.join();
            Err(error)
        }
        Err(_) => Err("The recording thread exited unexpectedly.".into()),
    }
}

type Opened = (cpal::Stream, u16, u32);

fn open_stream(
    device: Option<&str>,
    buffer: Arc<Mutex<Vec<f32>>>,
    peak: Arc<AtomicU32>,
) -> Result<Opened, String> {
    let device = pick_device(device)?;
    let supported = device
        .default_input_config()
        .map_err(|e| format!("The microphone is not available: {e}"))?;
    let format = supported.sample_format();
    let config: cpal::StreamConfig = supported.into();
    let stream = match format {
        SampleFormat::F32 => build::<f32>(&device, &config, buffer, peak),
        SampleFormat::I16 => build::<i16>(&device, &config, buffer, peak),
        SampleFormat::U16 => build::<u16>(&device, &config, buffer, peak),
        SampleFormat::I32 => build::<i32>(&device, &config, buffer, peak),
        SampleFormat::I8 => build::<i8>(&device, &config, buffer, peak),
        SampleFormat::U8 => build::<u8>(&device, &config, buffer, peak),
        other => return Err(format!("Unsupported microphone sample format {other:?}.")),
    }?;
    stream
        .play()
        .map_err(|e| format!("Could not start the microphone: {e}"))?;
    Ok((stream, config.channels, config.sample_rate.0))
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    buffer: Arc<Mutex<Vec<f32>>>,
    peak: Arc<AtomicU32>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let cap = (MAX_RECORDING.as_secs() as usize)
        * config.sample_rate.0 as usize
        * usize::from(config.channels);
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                let mut loudest = 0.0f32;
                let mut buffer = buffer.lock().unwrap_or_else(|e| e.into_inner());
                let room = cap.saturating_sub(buffer.len());
                for &sample in data.iter().take(room) {
                    let value = sample.to_sample::<f32>();
                    loudest = loudest.max(value.abs());
                    buffer.push(value);
                }
                drop(buffer);
                let previous = f32::from_bits(peak.load(Ordering::Relaxed));
                if loudest > previous {
                    peak.store(loudest.to_bits(), Ordering::Relaxed);
                }
            },
            |error| eprintln!("warpforge: microphone stream error: {error}"),
            None,
        )
        .map_err(|e| format!("Could not open the microphone: {e}"))
}
