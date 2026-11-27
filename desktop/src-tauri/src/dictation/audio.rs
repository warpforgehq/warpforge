/// Sample rate whisper expects.
pub const WHISPER_RATE: u32 = 16_000;

/// Average interleaved frames down to one channel.
/// @param interleaved samples, `channels` per frame
/// @param channels channel count of the input
/// @returns one sample per frame
pub fn downmix(interleaved: &[f32], channels: u16) -> Vec<f32> {
    let channels = usize::from(channels.max(1));
    if channels == 1 {
        return interleaved.to_vec();
    }
    interleaved
        .chunks_exact(channels)
        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
        .collect()
}

/// Resample mono audio to [`WHISPER_RATE`]. Downsampling averages over each
/// output step first, which is enough of a low-pass for speech.
/// @param mono input samples
/// @param rate input sample rate in Hz
/// @returns samples at 16 kHz
pub fn resample(mono: &[f32], rate: u32) -> Vec<f32> {
    if rate == WHISPER_RATE || mono.is_empty() || rate == 0 {
        return mono.to_vec();
    }
    let step = f64::from(rate) / f64::from(WHISPER_RATE);
    let out_len = ((mono.len() as f64) / step).floor() as usize;
    let last = mono.len() - 1;
    (0..out_len)
        .map(|i| {
            let pos = i as f64 * step;
            if step > 1.0 {
                let start = pos.floor() as usize;
                let end = ((pos + step).ceil() as usize).clamp(start + 1, mono.len());
                let window = &mono[start.min(last)..end];
                window.iter().sum::<f32>() / window.len() as f32
            } else {
                let base = pos.floor() as usize;
                let frac = (pos - base as f64) as f32;
                let a = mono[base.min(last)];
                let b = mono[(base + 1).min(last)];
                a + (b - a) * frac
            }
        })
        .collect()
}

/// Convert a raw capture into whisper's input format.
/// @param interleaved captured samples
/// @param channels channel count of the capture
/// @param rate sample rate of the capture
/// @returns 16 kHz mono samples
pub fn to_whisper_input(interleaved: &[f32], channels: u16, rate: u32) -> Vec<f32> {
    resample(&downmix(interleaved, channels), rate)
}

/// Root-mean-square level of a buffer.
/// @param samples audio samples
/// @returns RMS in 0.0..=1.0 for normalized input, 0.0 when empty
pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

const FRAME: usize = (WHISPER_RATE / 50) as usize;
const SPEECH_RMS: f32 = 0.01;

/// Whether any 20 ms frame is loud enough to hold speech. Whisper invents
/// sentences for silent input, so silent recordings are never transcribed.
/// @param samples 16 kHz mono samples
/// @returns true when at least one frame crosses the speech threshold
pub fn has_speech(samples: &[f32]) -> bool {
    samples.chunks(FRAME).any(|frame| rms(frame) >= SPEECH_RMS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(rate: u32, freq: f32, seconds: f32, amp: f32) -> Vec<f32> {
        let n = (rate as f32 * seconds) as usize;
        (0..n)
            .map(|i| amp * (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin())
            .collect()
    }

    #[test]
    fn downmix_averages_channels() {
        assert_eq!(downmix(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        assert_eq!(downmix(&[0.25, 0.75], 1), vec![0.25, 0.75]);
    }

    #[test]
    fn resample_keeps_duration() {
        for rate in [8_000, 22_050, 44_100, 48_000, 96_000] {
            let input = vec![0.0; rate as usize];
            let out = resample(&input, rate);
            assert!(
                (out.len() as i64 - 16_000).abs() <= 1,
                "{rate}: {}",
                out.len()
            );
        }
    }

    #[test]
    fn resample_identity_at_target_rate() {
        let input = vec![0.1, 0.2, 0.3];
        assert_eq!(resample(&input, WHISPER_RATE), input);
    }

    #[test]
    fn resample_preserves_tone_level() {
        let tone = sine(48_000, 440.0, 1.0, 0.5);
        let out = resample(&tone, 48_000);
        let expected = 0.5 / std::f32::consts::SQRT_2;
        assert!((rms(&out) - expected).abs() < 0.02, "rms {}", rms(&out));
    }

    #[test]
    fn upsample_interpolates() {
        let out = resample(&[0.0, 1.0], 8_000);
        assert_eq!(out.len(), 4);
        assert!((out[1] - 0.5).abs() < 1e-6);
    }

    #[test]
    fn whisper_input_from_stereo_48k() {
        let stereo: Vec<f32> = sine(48_000, 220.0, 0.5, 0.3)
            .into_iter()
            .flat_map(|s| [s, s])
            .collect();
        let out = to_whisper_input(&stereo, 2, 48_000);
        assert!((out.len() as i64 - 8_000).abs() <= 1);
    }

    #[test]
    fn silence_has_no_speech() {
        assert!(!has_speech(&[0.0; 16_000]));
        assert!(!has_speech(&[0.001; 16_000]));
        assert!(has_speech(&sine(16_000, 300.0, 0.1, 0.2)));
    }
}
