//! Screenshots of a tab, macOS only: `WKWebView.takeSnapshot` renders into an
//! `NSImage`. A picked element's shot is a PNG emitted as `browser:shot`, so the
//! agent gets the look of it, not just its text; `browser_screenshot` gets a JPEG.

use tauri::{AppHandle, Webview};

#[cfg(target_os = "macos")]
pub fn capture_element(
    app: &AppHandle,
    webview: &Webview,
    capture_id: String,
    rect: (f64, f64, f64, f64),
) {
    use base64::Engine;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSDictionary, NSError, NSString};
    use objc2_web_kit::WKSnapshotConfiguration;
    use tauri::Emitter;

    // NSImage → PNG bytes. Nested so the whole native path stays in one place.
    unsafe fn encode_png(image: &NSImage) -> Option<Vec<u8>> {
        let tiff = image.TIFFRepresentation()?;
        let rep = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
        let props: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::new();
        let png = rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props)?;
        Some(png.to_vec())
    }

    let app = app.clone();
    let (x, y, w, h) = rect;
    let _ = webview.with_webview(move |platform| unsafe {
        let Some(wk) = crate::browser::adopt_wk_webview(platform) else {
            return;
        };

        // with_webview runs on the main thread, where WKWebView must be touched.
        let mtm = MainThreadMarker::new().expect("with_webview runs on the main thread");
        let config = WKSnapshotConfiguration::new(mtm);
        config.setRect(CGRect::new(CGPoint::new(x, y), CGSize::new(w, h)));

        let handler = RcBlock::new(move |image: *mut NSImage, _err: *mut NSError| {
            if image.is_null() {
                return;
            }
            let Some(png) = encode_png(&*image) else {
                return;
            };
            let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
            let _ = app.emit(
                "browser:shot",
                serde_json::json!({ "captureId": capture_id, "pngBase64": b64 }),
            );
        });

        wk.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
    });
}

#[cfg(not(target_os = "macos"))]
pub fn capture_element(
    _app: &AppHandle,
    _webview: &Webview,
    _capture_id: String,
    _rect: (f64, f64, f64, f64),
) {
}

/// Widest a page screenshot is kept, in points, so it stays a size a model
/// takes in without resampling.
#[cfg(target_os = "macos")]
const PAGE_SHOT_WIDTH: f64 = 1024.0;

/// Screenshot what the tab shows, for the agent's `browser_screenshot`: a
/// base64 JPEG, or why there is none.
/// @param webview the tab's webview
/// @returns where the result arrives; it is sent exactly once
#[cfg(target_os = "macos")]
pub fn capture_page(
    webview: &Webview,
) -> Result<std::sync::mpsc::Receiver<Result<String, String>>, String> {
    use base64::Engine;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSImageCompressionFactor,
    };
    use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString};
    use objc2_web_kit::WKSnapshotConfiguration;
    use std::sync::Mutex;

    unsafe fn encode_jpeg(image: &NSImage) -> Option<Vec<u8>> {
        let tiff = image.TIFFRepresentation()?;
        let rep = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
        let quality = NSNumber::new_f64(0.7);
        let quality: &AnyObject = &quality;
        let props: Retained<NSDictionary<NSString, AnyObject>> =
            NSDictionary::from_slices(&[NSImageCompressionFactor], &[quality]);
        let jpeg = rep.representationUsingType_properties(NSBitmapImageFileType::JPEG, &props)?;
        Some(jpeg.to_vec())
    }

    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform| unsafe {
            let Some(wk) = crate::browser::adopt_wk_webview(platform) else {
                let _ = tx.send(Err("the tab has no native view".to_string()));
                return;
            };
            let mtm = MainThreadMarker::new().expect("with_webview runs on the main thread");
            let config = WKSnapshotConfiguration::new(mtm);
            if wk.bounds().size.width > PAGE_SHOT_WIDTH {
                config.setSnapshotWidth(Some(&NSNumber::new_f64(PAGE_SHOT_WIDTH)));
            }
            // WebKit calls the handler once; the Option keeps a second call inert.
            let tx = Mutex::new(Some(tx));
            let handler = RcBlock::new(move |image: *mut NSImage, _err: *mut NSError| {
                let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) else {
                    return;
                };
                let result = if image.is_null() {
                    Err(
                        "the page could not be captured; a tab that is not on screen may not \
                         render, so ask the user to show the browser pane"
                            .to_string(),
                    )
                } else {
                    encode_jpeg(&*image)
                        .map(|jpeg| base64::engine::general_purpose::STANDARD.encode(jpeg))
                        .ok_or_else(|| "the screenshot could not be encoded".to_string())
                };
                let _ = tx.send(result);
            });
            wk.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
        })
        .map_err(|e| e.to_string())?;
    Ok(rx)
}

#[cfg(not(target_os = "macos"))]
pub fn capture_page(
    _webview: &Webview,
) -> Result<std::sync::mpsc::Receiver<Result<String, String>>, String> {
    Err("browser screenshots are available on macOS only".to_string())
}

/// Screenshot a whole webview at `width` CSS pixels, 1x, as a base64 PNG:
/// the `render_preview` capture.
/// @param webview the preview webview
/// @param width the output width in pixels
/// @returns where the result arrives; it is sent exactly once
#[cfg(target_os = "macos")]
pub fn capture_png(
    webview: &Webview,
    width: f64,
) -> Result<std::sync::mpsc::Receiver<Result<String, String>>, String> {
    use base64::Engine;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString};
    use objc2_web_kit::WKSnapshotConfiguration;
    use std::sync::Mutex;

    unsafe fn encode_png(image: &NSImage) -> Option<Vec<u8>> {
        let tiff = image.TIFFRepresentation()?;
        let rep = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)?;
        let props: Retained<NSDictionary<NSString, AnyObject>> = NSDictionary::new();
        let png = rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props)?;
        Some(png.to_vec())
    }

    let (tx, rx) = std::sync::mpsc::channel();
    webview
        .with_webview(move |platform| unsafe {
            let Some(wk) = crate::browser::adopt_wk_webview(platform) else {
                let _ = tx.send(Err("the preview has no native view".to_string()));
                return;
            };
            let mtm = MainThreadMarker::new().expect("with_webview runs on the main thread");
            let config = WKSnapshotConfiguration::new(mtm);
            config.setSnapshotWidth(Some(&NSNumber::new_f64(width)));
            let tx = Mutex::new(Some(tx));
            let handler = RcBlock::new(move |image: *mut NSImage, _err: *mut NSError| {
                let Some(tx) = tx.lock().ok().and_then(|mut slot| slot.take()) else {
                    return;
                };
                let result = if image.is_null() {
                    Err("the preview could not be captured".to_string())
                } else {
                    encode_png(&*image)
                        .map(|png| base64::engine::general_purpose::STANDARD.encode(png))
                        .ok_or_else(|| "the preview could not be encoded".to_string())
                };
                let _ = tx.send(result);
            });
            wk.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
        })
        .map_err(|e| e.to_string())?;
    Ok(rx)
}

#[cfg(not(target_os = "macos"))]
pub fn capture_png(
    _webview: &Webview,
    _width: f64,
) -> Result<std::sync::mpsc::Receiver<Result<String, String>>, String> {
    Err("render_preview is available on macOS only; render_html still works".to_string())
}
