// Injected at the start of every agent HTML render's <head>. It speaks the
// MCP Apps protocol (JSON-RPC over postMessage) with the frame's host; method
// names are mirrored in html_render/mod.rs and desktop/src/protocol/htmlRender.ts.
(function () {
  var theme = document.getElementById("wf-render-theme");
  var links = 0;

  // Rewrites its own <style> rather than setting inline properties, so the
  // page's later :root rules still win.
  function apply(next) {
    if (!theme || !next || typeof next !== "object") return;
    var vars = next.variables;
    if (!vars || typeof vars !== "object") return;
    var css = ":root{color-scheme:" + (next.appearance === "light" ? "light" : "dark") + ";";
    for (var name in vars) {
      if (/^--[a-z0-9-]+$/.test(name)) {
        css += name + ":" + String(vars[name]).replace(/[;{}<>]/g, "") + ";";
      }
    }
    theme.textContent = css + "}";
  }

  // The first theme arrives in the URL fragment, before first paint; the
  // fragment is dropped so the page's own hash routing never sees it.
  try {
    var match = /[#&]wf-theme=([^&]*)/.exec(location.hash);
    if (match) {
      apply(JSON.parse(decodeURIComponent(match[1])));
      history.replaceState(history.state, "", location.pathname + location.search);
    }
  } catch (e) {}

  window.addEventListener("message", function (event) {
    var data = event.data;
    var params = data && data.params;
    if (
      data &&
      data.jsonrpc === "2.0" &&
      data.method === "ui/notifications/host-context-changed" &&
      params &&
      params.styles
    ) {
      apply({ appearance: params.theme, variables: params.styles.variables });
    }
  });

  if (window.parent === window) return;

  // A clicked link never replaces the page inside the chat; the host is asked
  // to open it instead.
  document.addEventListener(
    "click",
    function (event) {
      if (!event.isTrusted) return;
      var link = event.composedPath().find(function (node) {
        return node && node.matches && node.matches("a[href]");
      });
      if (!link) return;
      var url;
      try {
        url = new URL(link.getAttribute("href"), document.baseURI);
      } catch (e) {
        return;
      }
      if (!/^https?:$/.test(url.protocol)) return;
      if (url.href.split("#")[0] === location.href.split("#")[0]) return;
      event.preventDefault();
      window.parent.postMessage(
        {
          jsonrpc: "2.0",
          id: "wf-link-" + ++links,
          method: "ui/open-link",
          params: { url: url.href },
        },
        "*",
      );
    },
    true,
  );

  var reported;
  var observer;
  function report() {
    var root = document.documentElement;
    var height = Math.ceil(
      root.scrollHeight > root.clientHeight ? root.scrollHeight : root.getBoundingClientRect().height,
    );
    if (height === reported) return;
    reported = height;
    window.parent.postMessage(
      { jsonrpc: "2.0", method: "ui/notifications/size-changed", params: { height: height } },
      "*",
    );
  }
  if (window.ResizeObserver) {
    observer = new ResizeObserver(report);
    observer.observe(document.documentElement);
  }
  document.addEventListener("DOMContentLoaded", function () {
    if (observer && document.body) observer.observe(document.body);
    report();
  });
  window.addEventListener("load", report);
})();
