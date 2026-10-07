// Injected after the bootstrap on render_preview pages only: reports console
// warnings, errors and uncaught failures to the preview host.
(function () {
  if (window.parent === window) return;
  var sent = 0;
  function post(level, parts) {
    if (sent >= 20) return;
    sent++;
    var text = Array.prototype.map
      .call(parts, function (part) {
        if (part instanceof Error) return part.stack || String(part);
        if (typeof part === "string") return part;
        try {
          return JSON.stringify(part);
        } catch (e) {
          return String(part);
        }
      })
      .join(" ");
    window.parent.postMessage(
      { jsonrpc: "2.0", method: "notifications/message", params: { level: level, data: text.slice(0, 500) } },
      "*",
    );
  }
  var warn = console.warn;
  var error = console.error;
  console.warn = function () {
    post("warning", arguments);
    return warn.apply(console, arguments);
  };
  console.error = function () {
    post("error", arguments);
    return error.apply(console, arguments);
  };
  window.addEventListener("error", function (event) {
    var where = event.lineno ? " (line " + event.lineno + ")" : "";
    post("error", [(event.message || "uncaught error") + where]);
  });
  window.addEventListener("unhandledrejection", function (event) {
    post("error", ["unhandled rejection: ", event.reason]);
  });
})();
