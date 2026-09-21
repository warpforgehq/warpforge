// Element picker injected into every browser tab before page scripts run.
//
// Dormant until the host calls `__wfPickStart()`. In pick mode a full-window
// capture overlay eats the mouse — so the cursor is always a crosshair and the
// page gets no hover or clicks — and the element under the pointer is resolved
// with `elementFromPoint`. A trusted click sends that element's context to the
// host by navigating to `wf-annotate://a/?d=<encoded json>`, which the Rust
// `on_navigation` handler intercepts and blocks. The overlay lives in a closed
// shadow root and every listener is gated on `isTrusted`, so a page script can
// neither read it nor drive it.
(function () {
  if (window.__wfPickerInstalled) return;
  window.__wfPickerInstalled = true;

  let picking = false;
  let host = null;
  let outline = null;

  function ensureOverlay() {
    if (host) return;
    host = document.createElement("div");
    // Captures the mouse while picking; inert otherwise.
    host.style.cssText =
      "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;cursor:crosshair";
    const shadow = host.attachShadow({ mode: "closed" });
    outline = document.createElement("div");
    outline.style.cssText =
      "position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,0.15);border-radius:3px;transition:all 40ms;display:none;pointer-events:none";
    shadow.appendChild(outline);
    (document.documentElement || document.body).appendChild(host);

    host.addEventListener("mousemove", onMove, true);
    host.addEventListener("click", onClick, true);
  }

  // The overlay is topmost, so hit-testing means briefly making it transparent
  // to the pointer, asking the document, then restoring capture.
  function elementUnder(x, y) {
    host.style.pointerEvents = "none";
    const el = document.elementFromPoint(x, y);
    host.style.pointerEvents = "auto";
    return el;
  }

  function drawOutline(el) {
    const r = el.getBoundingClientRect();
    outline.style.display = "block";
    outline.style.left = r.left + "px";
    outline.style.top = r.top + "px";
    outline.style.width = r.width + "px";
    outline.style.height = r.height + "px";
  }

  // A short, reasonably stable selector: an id when present, else a path of
  // tag:nth-of-type up to four levels.
  function selectorFor(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sibs = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (sibs.length > 1) part += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function contextFor(el) {
    return {
      url: location.href,
      selector: selectorFor(el),
      role: el.getAttribute("role") || el.tagName.toLowerCase(),
      text: (el.innerText || el.textContent || "").trim().slice(0, 400),
      href: el.tagName === "A" ? el.href : null,
    };
  }

  function stop() {
    picking = false;
    if (host) host.style.pointerEvents = "none";
    if (outline) outline.style.display = "none";
  }

  function send(el) {
    const encoded = encodeURIComponent(JSON.stringify(contextFor(el)));
    // A blocked navigation is the message channel; the host cancels it.
    location.href = "wf-annotate://a/?d=" + encoded;
  }

  function onMove(e) {
    if (!picking || !e.isTrusted) return;
    const el = elementUnder(e.clientX, e.clientY);
    if (el && el.nodeType === 1) drawOutline(el);
  }

  function onClick(e) {
    if (!picking || !e.isTrusted) return;
    e.preventDefault();
    e.stopPropagation();
    const el = elementUnder(e.clientX, e.clientY);
    stop();
    if (el && el.nodeType === 1) send(el);
  }

  document.addEventListener(
    "keydown",
    (e) => {
      if (picking && e.key === "Escape") {
        e.preventDefault();
        stop();
      }
    },
    true,
  );

  // Any navigation leaves pick mode, so a page change never strands the overlay.
  window.addEventListener("pagehide", stop, true);

  window.__wfPickStart = function () {
    ensureOverlay();
    picking = true;
    host.style.pointerEvents = "auto";
  };
  window.__wfPickStop = stop;
})();
