import { ExternalLink, Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { openExternalLink } from "@/lib/externalLinks";

import { daemon } from "../daemon";

type Step =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "code"; url: string; busy: boolean; error?: string };

/**
 * Google sign-in for an agent whose login prints a link and then asks for the
 * code the provider's page shows (Antigravity).
 * @param agentId the agent to sign in
 * @param displayName the agent's name, for the dialog title
 * @param onDone called with null once the agent starts, or with why it did not
 * @returns the Sign in button and its dialog
 */
export function AgentSignIn({
  agentId,
  displayName,
  onDone,
}: {
  agentId: string;
  displayName: string;
  onDone: (error: string | null) => void;
}) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [code, setCode] = useState("");

  const start = async () => {
    setStep({ kind: "starting" });
    setCode("");
    try {
      const url = await daemon.startAgentSignIn(agentId);
      setStep({ kind: "code", url, busy: false });
      void openExternalLink(url);
    } catch (e) {
      setStep({ kind: "idle" });
      onDone(e instanceof Error ? e.message : String(e));
    }
  };

  const finish = async () => {
    if (step.kind !== "code") return;
    setStep({ ...step, busy: true, error: undefined });
    try {
      const result = await daemon.finishAgentSignIn(agentId, code);
      setStep({ kind: "idle" });
      onDone(result.verified ? null : (result.verifyError ?? "the agent still cannot start"));
    } catch (e) {
      setStep({ ...step, busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        className="h-7 whitespace-nowrap px-2 text-[13px]"
        disabled={step.kind !== "idle"}
        onClick={(e) => {
          e.stopPropagation();
          void start();
        }}
      >
        {step.kind === "starting" && <Loader2 className="size-3 animate-spin" />}
        {step.kind === "starting" ? "Starting…" : "Sign in"}
      </Button>
      <Dialog
        open={step.kind === "code"}
        onOpenChange={(open) => {
          if (!open && step.kind === "code" && !step.busy) setStep({ kind: "idle" });
        }}
      >
        <DialogContent onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Sign in to {displayName}</DialogTitle>
            <DialogDescription>
              Sign in with Google in your browser. The last page shows a code — paste it here.
            </DialogDescription>
          </DialogHeader>
          {step.kind === "code" && (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void finish();
              }}
            >
              <Button
                type="button"
                variant="outline"
                className="justify-start"
                onClick={() => void openExternalLink(step.url)}
              >
                <ExternalLink className="size-3.5" />
                Open the Google sign-in page again
              </Button>
              <Input
                autoFocus
                placeholder="Code from the Antigravity page"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={step.busy}
              />
              {step.error && <p className="text-[12px] text-destructive">{step.error}</p>}
              <DialogFooter>
                <Button type="submit" disabled={step.busy || code.trim() === ""}>
                  {step.busy && <Loader2 className="size-3 animate-spin" />}
                  {step.busy ? "Checking…" : "Sign in"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
