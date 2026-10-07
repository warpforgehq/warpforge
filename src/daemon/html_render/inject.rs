//! Put the render bootstrap at the start of an agent page's `<head>`, ahead of
//! the page's own styles and scripts, so the first paint is already themed.

use warpforge_protocol::html_render::{BASE_CSS, BOOTSTRAP_JS};

/// The theme before the host sends one: system colours, so the page follows
/// the OS appearance and the app's palette lives only in the desktop.
const FALLBACK_THEME: &str = ":root{color-scheme:light dark;--background:Canvas;\
--foreground:CanvasText;--muted-foreground:GrayText;--border:GrayText;\
--font-sans:system-ui,sans-serif;--font-mono:\"SF Mono\",Menlo,monospace}";

const RAW_TEXT: &[&str] = &[
    "script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript",
];

/// Inject the bootstrap into a page.
/// @param html the agent's page
/// @param extra_script a script to run right after the bootstrap, if any
/// @returns the page with the bootstrap in its head
pub(crate) fn inject_bootstrap(html: &str, extra_script: Option<&str>) -> String {
    let scan = blank_non_markup(html);
    let markup = bootstrap_markup(&scan, extra_script);
    if let Some(at) = find_open_tag(&scan, b"head") {
        return format!("{}{markup}{}", &html[..at], &html[at..]);
    }
    if let Some(at) = find_open_tag(&scan, b"html") {
        return format!("{}<head>{markup}</head>{}", &html[..at], &html[at..]);
    }
    if let Some(at) = leading_doctype_end(&scan) {
        return format!("{}<head>{markup}</head>{}", &html[..at], &html[at..]);
    }
    format!("<!doctype html><head>{markup}</head>{html}")
}

fn bootstrap_markup(scan: &[u8], extra_script: Option<&str>) -> String {
    let mut out = String::new();
    if !has_meta(&scan[..scan.len().min(4096)], is_charset_meta) {
        out.push_str("<meta charset=\"utf-8\">");
    }
    if !has_meta(scan, is_viewport_meta) {
        out.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">");
    }
    out.push_str(&format!(
        "<style id=\"wf-render-base\">{}</style><style id=\"wf-render-theme\">{FALLBACK_THEME}</style><script>{BOOTSTRAP_JS}</script>",
        BASE_CSS.trim()
    ));
    if let Some(script) = extra_script {
        out.push_str(&format!("<script>{script}</script>"));
    }
    out
}

fn is_name_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// A lowercased copy of the page with comments, raw-text elements, template
/// contents and `<plaintext>` blanked to spaces of the same length, so byte
/// offsets match the page and tags inside them are never matched.
fn blank_non_markup(html: &str) -> Vec<u8> {
    let mut scan = html.as_bytes().to_ascii_lowercase();
    let len = scan.len();
    let mut i = 0;
    while i < len {
        if scan[i] != b'<' {
            i += 1;
            continue;
        }
        let end = if scan[i..].starts_with(b"<!--") {
            find(&scan, i + 4, b"-->").map_or(len, |at| at + 3)
        } else if let Some(name) = RAW_TEXT
            .iter()
            .find(|name| starts_tag(&scan, i, name.as_bytes()))
        {
            raw_text_end(&scan, i + 1 + name.len(), name.as_bytes())
        } else if starts_tag(&scan, i, b"plaintext") {
            len
        } else {
            i += 1;
            continue;
        };
        scan[i..end].fill(b' ');
        i = end;
    }
    blank_templates(&mut scan);
    scan
}

/// Whether `<name` starts at `at` and is not the prefix of a longer name.
fn starts_tag(scan: &[u8], at: usize, name: &[u8]) -> bool {
    let after = at + 1 + name.len();
    scan.get(at) == Some(&b'<')
        && scan.get(at + 1..after) == Some(name)
        && scan.get(after).is_none_or(|&b| !is_name_byte(b))
}

/// Where a raw-text element opened before `from` ends: after `</name\s*>`, or
/// at the end of the page.
fn raw_text_end(scan: &[u8], from: usize, name: &[u8]) -> usize {
    let mut close = Vec::with_capacity(name.len() + 2);
    close.extend_from_slice(b"</");
    close.extend_from_slice(name);
    let mut at = from;
    while let Some(found) = find(scan, at, &close) {
        let mut j = found + close.len();
        while scan.get(j).is_some_and(u8::is_ascii_whitespace) {
            j += 1;
        }
        if scan.get(j) == Some(&b'>') {
            return j + 1;
        }
        at = found + 1;
    }
    scan.len()
}

/// Blank `<template>…</template>` including nested templates; an unclosed
/// one is blanked to the end.
fn blank_templates(scan: &mut [u8]) {
    let mut depth = 0usize;
    let mut start = 0;
    let mut i = 0;
    while i < scan.len() {
        let closing = scan[i..].starts_with(b"</template");
        let opening = !closing && scan[i..].starts_with(b"<template");
        if !opening && !closing {
            i += 1;
            continue;
        }
        let name_end = i + if closing { 10 } else { 9 };
        let Some(end) = tag_close(scan, name_end) else {
            i += 1;
            continue;
        };
        if opening {
            if depth == 0 {
                start = i;
            }
            depth += 1;
        } else if depth > 0 {
            depth -= 1;
            if depth == 0 {
                scan[start..end].fill(b' ');
            }
        }
        i = end;
    }
    if depth > 0 {
        scan[start..].fill(b' ');
    }
}

/// After a tag name ending at `at`: the offset just past the tag's `>` when
/// the name is followed by `>`, `/` or whitespace, else `None`.
fn tag_close(scan: &[u8], at: usize) -> Option<usize> {
    match scan.get(at)? {
        b'>' => Some(at + 1),
        b'/' if scan.get(at + 1) == Some(&b'>') => Some(at + 2),
        b if b.is_ascii_whitespace() || *b == b'/' => find(scan, at, b">").map(|gt| gt + 1),
        _ => None,
    }
}

/// The offset just past the first `<name …>` tag, so `<header>` never counts
/// as `<head>`.
fn find_open_tag(scan: &[u8], name: &[u8]) -> Option<usize> {
    let mut at = 0;
    while let Some(found) = find(scan, at, b"<") {
        if scan[found + 1..].starts_with(name) {
            if let Some(end) = tag_close(scan, found + 1 + name.len()) {
                return Some(end);
            }
        }
        at = found + 1;
    }
    None
}

fn leading_doctype_end(scan: &[u8]) -> Option<usize> {
    let start = scan.iter().position(|b| !b.is_ascii_whitespace())?;
    if !scan[start..].starts_with(b"<!doctype") {
        return None;
    }
    find(scan, start, b">").map(|gt| gt + 1)
}

fn has_meta(scan: &[u8], matches: fn(&[u8]) -> bool) -> bool {
    let mut at = 0;
    while let Some(found) = find(scan, at, b"<meta") {
        let body = found + 5;
        if scan.get(body).is_some_and(u8::is_ascii_whitespace) {
            let end = find(scan, body, b">").unwrap_or(scan.len());
            if matches(&scan[body..end]) {
                return true;
            }
        }
        at = found + 1;
    }
    false
}

fn is_charset_meta(attrs: &[u8]) -> bool {
    find(attrs, 0, b"charset").is_some()
}

fn is_viewport_meta(attrs: &[u8]) -> bool {
    let mut at = 0;
    while let Some(found) = find(attrs, at, b"name") {
        let mut j = found + 4;
        let skip_space = |j: &mut usize| {
            while attrs.get(*j).is_some_and(u8::is_ascii_whitespace) {
                *j += 1;
            }
        };
        skip_space(&mut j);
        if attrs.get(j) == Some(&b'=') {
            j += 1;
            skip_space(&mut j);
            if matches!(attrs.get(j), Some(b'"' | b'\'')) {
                j += 1;
            }
            if attrs[j..].starts_with(b"viewport") {
                return true;
            }
        }
        at = found + 1;
    }
    false
}

fn find(haystack: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    if from > haystack.len() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|at| at + from)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARK: &str = "<style id=\"wf-render-base\">";

    fn head_of(page: &str) -> usize {
        page.find(MARK).expect("bootstrap injected")
    }

    #[test]
    fn goes_first_in_an_existing_head_with_attributes() {
        let page = inject_bootstrap(
            "<!DOCTYPE html><html><HEAD lang=\"en\"><style>p{}</style></HEAD><body>x</body></html>",
            None,
        );
        assert!(page.starts_with("<!DOCTYPE html><html><HEAD lang=\"en\"><meta charset"));
        assert!(head_of(&page) < page.find("<style>p{}").unwrap());
        assert!(!page.contains("</head>"), "no second head added");
    }

    #[test]
    fn wraps_a_head_after_html_or_a_doctype_or_prepends_one() {
        let html = inject_bootstrap("<html lang=\"en\"><body>x</body></html>", None);
        assert!(html.starts_with("<html lang=\"en\"><head><meta charset"));
        assert!(html.contains("</head><body>x"));

        let doctype = inject_bootstrap("  <!doctype html><p>x</p>", None);
        assert!(doctype.starts_with("  <!doctype html><head><meta"));
        assert!(doctype.ends_with("</head><p>x</p>"));

        let bare = inject_bootstrap("<p>x</p>", None);
        assert!(bare.starts_with("<!doctype html><head><meta charset"));
        assert!(bare.ends_with("</head><p>x</p>"));
    }

    #[test]
    fn a_header_element_is_not_a_head() {
        let page = inject_bootstrap("<html><header>top</header></html>", None);
        assert!(page.starts_with("<html><head>"));
        assert!(page.contains("<header>top</header>"));
    }

    #[test]
    fn heads_inside_inert_markup_are_ignored() {
        for inert in [
            "<!-- <head> -->",
            "<script>var s = '<head>';</script>",
            "<template><head></template>",
            "<template><template></template><head></template>",
            "<textarea><head></textarea >",
            "<title><head></title>",
        ] {
            let page = inject_bootstrap(&format!("{inert}<p>x</p>"), None);
            assert!(page.starts_with("<!doctype html><head>"), "{inert}: {page}");
            assert!(
                page.ends_with(&format!("</head>{inert}<p>x</p>")),
                "{inert}"
            );
        }
    }

    #[test]
    fn an_unclosed_comment_hides_the_rest() {
        let page = inject_bootstrap("<!-- <head><p>x</p>", None);
        assert!(page.starts_with("<!doctype html><head>"));
    }

    #[test]
    fn existing_charset_and_viewport_are_not_duplicated() {
        let page = inject_bootstrap(
            "<head><meta charset=\"utf-8\"><meta name='viewport' content='width=500'></head>",
            None,
        );
        assert_eq!(page.matches("charset").count(), 1);
        assert_eq!(page.matches("viewport").count(), 1);
    }

    #[test]
    fn a_meta_in_a_comment_does_not_count() {
        let page = inject_bootstrap("<head><!-- <meta charset=\"x\"> --></head>", None);
        assert!(page.contains("<meta charset=\"utf-8\">"));
    }

    #[test]
    fn the_extra_script_runs_after_the_bootstrap_and_before_the_page() {
        let page = inject_bootstrap("<head><script>page()</script></head>", Some("extra()"));
        let bootstrap = page.find("wf-render-theme\")").unwrap();
        let extra = page.find("<script>extra()</script>").unwrap();
        let own = page.find("<script>page()</script>").unwrap();
        assert!(bootstrap < extra && extra < own);
    }

    #[test]
    fn multibyte_text_keeps_offsets_aligned() {
        let page = inject_bootstrap("<!-- é --><html><head>ü</head></html>", None);
        assert!(page.starts_with("<!-- é --><html><head><meta"));
        assert!(page.ends_with("ü</head></html>"));
    }
}
