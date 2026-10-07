//! Agent HTML renders: self-contained pages an agent shows inline in a task's
//! chat with `render_html`, and checks first with `render_preview`. The daemon
//! injects one bootstrap into every page; the desktop frames it in a sandboxed
//! iframe and talks to it over postMessage (`docs/adr/0025`).

/// Largest page accepted, in bytes.
pub const MAX_HTML_BYTES: usize = 512_000;
/// Longest title accepted, in characters.
pub const MAX_TITLE_CHARS: usize = 200;
/// Frame height bounds, in CSS pixels.
pub const MIN_HEIGHT: u32 = 80;
pub const MAX_HEIGHT: u32 = 2000;
/// Preview viewport width bounds and default, in CSS pixels. The default is
/// the chat's reply column.
pub const MIN_PREVIEW_WIDTH: u32 = 240;
pub const MAX_PREVIEW_WIDTH: u32 = 1600;
pub const DEFAULT_PREVIEW_WIDTH: u32 = 720;

/// Host → page: the theme changed.
pub const HOST_CONTEXT_CHANGED: &str = "ui/notifications/host-context-changed";
/// Page → host: the page's content height changed.
pub const SIZE_CHANGED: &str = "ui/notifications/size-changed";
/// Page → host: the reader clicked an http(s) link.
pub const OPEN_LINK: &str = "ui/open-link";
/// Page → preview host: a console warning or error.
pub const LOG_MESSAGE: &str = "notifications/message";
/// URL fragment key that carries the first theme into the page.
pub const THEME_FRAGMENT_KEY: &str = "wf-theme";

/// The script injected at the start of every page's `<head>`.
pub const BOOTSTRAP_JS: &str = include_str!("bootstrap.js");
/// The base stylesheet every page gets, ahead of its own styles.
pub const BASE_CSS: &str = include_str!("base.css");
/// Injected after the bootstrap on preview pages only.
pub const PREVIEW_CONSOLE_JS: &str = include_str!("preview_console.js");

/// Check a page before it is stored or previewed.
/// @param html the page
/// @returns why it is refused
pub fn validate_html(html: &str) -> Result<(), String> {
    if html.trim().is_empty() {
        return Err("the page is empty".into());
    }
    if html.len() > MAX_HTML_BYTES {
        return Err(format!(
            "the page is {} KB; the limit is {} KB",
            html.len().div_ceil(1000),
            MAX_HTML_BYTES / 1000
        ));
    }
    Ok(())
}

/// Check a page title.
/// @param title the title as the agent gave it
/// @returns the trimmed title, or why it is refused
pub fn validate_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("the title is empty".into());
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        return Err(format!(
            "the title is longer than {MAX_TITLE_CHARS} characters"
        ));
    }
    Ok(title.to_string())
}

/// A frame height inside the allowed range.
/// @param height the requested height in CSS pixels
/// @returns the rounded, clamped height
pub fn clamp_height(height: f64) -> u32 {
    if !height.is_finite() {
        return MIN_HEIGHT;
    }
    (height.round() as i64).clamp(MIN_HEIGHT as i64, MAX_HEIGHT as i64) as u32
}

/// A preview width inside the allowed range.
/// @param width the requested width, if any
/// @returns the clamped width, or the reply column's when none was given
pub fn clamp_width(width: Option<i64>) -> u32 {
    width.map_or(DEFAULT_PREVIEW_WIDTH, |w| {
        w.clamp(MIN_PREVIEW_WIDTH as i64, MAX_PREVIEW_WIDTH as i64) as u32
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pages_are_refused_when_empty_or_over_the_limit() {
        assert!(validate_html("<p>hi</p>").is_ok());
        assert!(validate_html("  \n").is_err());
        assert!(validate_html(&"a".repeat(MAX_HTML_BYTES)).is_ok());
        let error = validate_html(&"a".repeat(MAX_HTML_BYTES + 1)).unwrap_err();
        assert!(error.contains("limit is 512 KB"), "{error}");
    }

    #[test]
    fn titles_are_trimmed_and_bounded_in_characters() {
        assert_eq!(validate_title("  Revenue  ").unwrap(), "Revenue");
        assert!(validate_title(" ").is_err());
        assert!(validate_title(&"é".repeat(MAX_TITLE_CHARS)).is_ok());
        assert!(validate_title(&"é".repeat(MAX_TITLE_CHARS + 1)).is_err());
    }

    #[test]
    fn heights_and_widths_are_clamped() {
        assert_eq!(clamp_height(10.0), MIN_HEIGHT);
        assert_eq!(clamp_height(420.4), 420);
        assert_eq!(clamp_height(1e9), MAX_HEIGHT);
        assert_eq!(clamp_height(f64::NAN), MIN_HEIGHT);
        assert_eq!(clamp_width(None), DEFAULT_PREVIEW_WIDTH);
        assert_eq!(clamp_width(Some(100)), MIN_PREVIEW_WIDTH);
        assert_eq!(clamp_width(Some(390)), 390);
        assert_eq!(clamp_width(Some(9000)), MAX_PREVIEW_WIDTH);
    }

    #[test]
    fn the_bootstrap_speaks_the_method_names_declared_here() {
        for name in [
            HOST_CONTEXT_CHANGED,
            SIZE_CHANGED,
            OPEN_LINK,
            THEME_FRAGMENT_KEY,
        ] {
            assert!(BOOTSTRAP_JS.contains(name), "{name}");
        }
        assert!(BOOTSTRAP_JS.contains("wf-render-theme"));
        assert!(PREVIEW_CONSOLE_JS.contains(LOG_MESSAGE));
    }
}
