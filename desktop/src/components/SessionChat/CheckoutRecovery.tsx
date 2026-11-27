import { useState } from "react";

import { Button } from "@/components/ui/button";
import { daemon } from "@/daemon";
import { useUi } from "@/store/ui";

export function CheckoutRecovery({ project, reason }: { project: string; reason: string | null }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function retry() {
    setRetrying(true);
    setError(null);
    void daemon
      .runnerRetryCheckout(project)
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => setRetrying(false));
  }

  function openTerminal() {
    const ui = useUi.getState();
    ui.setProjectSurface(project, "terminal");
    ui.setSidebarMode("tasks");
    ui.openProject(project);
  }

  return (
    <section
      aria-label="Factory checkout recovery"
      className="space-y-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-sm"
    >
      <p>{reason ?? "Factory needs the project folder before it can continue."}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={retrying} onClick={retry}>
          {retrying ? "Trying…" : "Try again"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={openTerminal}>
          Open terminal
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
