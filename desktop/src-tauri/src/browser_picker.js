// Element picker injected into every browser tab before page scripts run.
//
// Dormant until the host calls `__wfPickStart()`. In pick mode it outlines the
// element under the cursor and, on a trusted click, sends its context to the
// host by navigating to `wf-annotate://a/?d=<encoded json>`, which the Rust
// `on_navigation` handler intercepts and blocks. Everything lives in a closed
// shadow root so the page cannot read the overlay, and every listener is
// capture-phase and gated on `isTrusted` so a page script cannot drive it.
(function () {
  if (window.__wfPickerInstalled) return;
  window.__wfPickerInstalled = true;

  let picking = false;
  let host = null;
  let outline = null;

  function ensureOverlay() {
    if (host) return;
    host = document.createElement("div");
    host.style.cssText =
      "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const shadow = host.attachShadow({ mode: "closed" });
    outline = document.createElement("div");
    outline.style.cssText =
      "position:fixed;border:2px solid #3b82f6;background:rgba(59,130,246,0.15);border-radius:3px;transition:all 40ms;display:none";
    shadow.appendChild(outline);
    (document.documentElement || document.body).appendChild(host);
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
    if (outline) outline.style.display = "none";
  }

  function send(el) {
    const json = JSON.stringify(contextFor(el));
    const encoded = encodeURIComponent(json);
    // A blocked navigation is the message channel; the host cancels it.
    location.href = "wf-annotate://a/?d=" + encoded;
  }

  document.addEventListener(
    "mousemove",
    (e) => {
      if (!picking || !e.isTrusted) return;
      const el = e.target;
      if (el && el.nodeType === 1 && el !== host) drawOutline(el);
    },
    true,
  );

  document.addEventListener(
    "click",
    (e) => {
      if (!picking || !e.isTrusted) return;
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;
      stop();
      if (el && el.nodeType === 1) send(el);
    },
    true,
  );

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

  window.__wfPickStart = function () {
    ensureOverlay();
    picking = true;
  };
})();
