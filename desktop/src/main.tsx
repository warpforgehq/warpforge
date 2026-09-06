import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";

import App from "./App";
import { queryClient } from "./query";

// CSS is loaded for its global side effect at the application boundary.
// eslint-disable-next-line import/no-unassigned-import
import "./globals.css";

if (import.meta.env.DEV) {
  void import("./lib/memProbe").then(({ installMemProbe }) => {
    installMemProbe();
  });
}

const reactScanEnabled = import.meta.env.DEV && import.meta.env.VITE_REACT_SCAN === "true";

if (reactScanEnabled) {
  void import("react-scan").then(({ scan }) => {
    scan({ enabled: true, showToolbar: true });
  });
}

// The splash is the opaque cover from index.html. Two frames after the mount
// commit the app is on screen, so the fade reveals UI — not the desktop blur
// the window switches to once glass turns on.
function dismissBootSplash() {
  const splash = document.getElementById("boot-splash");
  if (!splash) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      splash.classList.add("boot-splash-out");
      window.setTimeout(() => splash.remove(), 180);
    });
  });
}

// Paint immediately; connect after the first frame so the daemon client's
// heavy deps don't extend the white screen before React mounts.
requestAnimationFrame(() => {
  void import("./daemon").then(({ daemon }) => {
    void daemon.connect().catch(() => {
      /* Reconnect loop takes over */
    });
  });
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster
        theme="dark"
        position="bottom-right"
        closeButton
        duration={4000}
        toastOptions={{
          classNames: {
            toast:
              "!rounded-xl !border-border !bg-popover !p-4 !text-xs !text-popover-foreground !shadow-2xl data-[styled=false]:!border-0 data-[styled=false]:!bg-transparent data-[styled=false]:!p-0 data-[styled=false]:!shadow-none",
            description: "!text-muted-foreground",
            closeButton:
              "!border-border !bg-secondary !text-secondary-foreground hover:!bg-accent hover:!text-accent-foreground",
            info: "[&_[data-icon]]:!text-primary",
            success: "[&_[data-icon]]:!text-ok",
            warning: "[&_[data-icon]]:!text-warn",
            error: "[&_[data-icon]]:!text-destructive",
          },
        }}
      />
    </QueryClientProvider>
  </React.StrictMode>,
);

dismissBootSplash();
