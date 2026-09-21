//! Screenshot of a picked element, so the agent gets the look of it, not just
//! its text. macOS only: `WKWebView.takeSnapshot` renders the given rect into an
//! `NSImage`, encoded to PNG and emitted as `browser:shot`.

use tauri::{AppHandle, Webview};

#[cfg(target_os = "macos")]
pub fn capture_element(
    app: &AppHandle,
    webview: &Webview,
    tab_id: String,
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
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
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
        let wk = &*(platform.inner() as *mut WKWebView);

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
                serde_json::json!({ "tabId": tab_id, "pngBase64": b64 }),
            );
        });

        wk.takeSnapshotWithConfiguration_completionHandler(Some(&config), &handler);
    });
}

#[cfg(not(target_os = "macos"))]
pub fn capture_element(
    _app: &AppHandle,
    _webview: &Webview,
    _tab_id: String,
    _rect: (f64, f64, f64, f64),
) {
}
