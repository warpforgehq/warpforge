import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { EffectiveProjectConfig, ProjectConfigScope, ProjectConfigService } from "@/protocol";
import { settingsControl, Toggle } from "@/views/settings/primitives";

import {
  clearEdits,
  DraftInput,
  FieldRow,
  localEdge,
  ScopeToggle,
  setEdits,
  TextField,
  useFieldScope,
} from "./fields";
import type { ConfigEdit } from "./useProjectConfig";

interface Props {
  name: string;
  service: ProjectConfigService;
  view: EffectiveProjectConfig;
  edit: (edits: ConfigEdit[]) => void;
  readOnly: boolean;
}

/** The fields of one service, shown when its row is expanded. */
export function ServiceEditor({ name, service, view, edit, readOnly }: Props) {
  const at = (...rest: string[]) => ["services", name, ...rest];
  const common = { edit, readOnly, view };
  return (
    <div className="px-3.5 pb-3">
      <TextField {...common} path={at("command")} label="Command" value={service.command} mono />
      <TextField {...common} path={at("port")} label="Port" value={service.port} numeric />
      <TextField
        {...common}
        path={at("readyPattern")}
        label="Ready pattern"
        hint="Log line that means up"
        value={service.readyPattern}
        mono
      />
      <TextField
        {...common}
        path={at("readyTimeout")}
        label="Ready timeout"
        placeholder="e.g. 60s"
        value={service.readyTimeout}
      />
      <TextField
        {...common}
        path={at("healthcheck", "url")}
        label="Health check URL"
        value={service.healthcheck?.url ?? null}
        mono
      />
      {service.healthcheck && (
        <TextField
          {...common}
          path={at("healthcheck", "interval")}
          label="Check interval"
          placeholder="e.g. 5s"
          value={service.healthcheck.interval}
        />
      )}
      <PortFallback {...common} path={at("portFallback")} on={service.portFallback === "auto"} />
      <DependsOn {...common} name={name} value={service.dependsOn} />
      <EnvTable {...common} name={name} env={service.env ?? {}} />
    </div>
  );
}

type Common = Omit<Props, "name" | "service">;

function PortFallback({
  view,
  edit,
  readOnly,
  path,
  on,
}: Common & { path: string[]; on: boolean }) {
  const scope = useFieldScope(view, path, "shared", on ? "auto" : undefined, edit);
  return (
    <FieldRow
      label="Port fallback"
      hint="Take a free port if busy"
      scope={scope}
      readOnly={readOnly}
    >
      <Toggle
        id={`fallback-${path[1]}`}
        label="Port fallback"
        checked={on}
        disabled={readOnly}
        onChange={(next) =>
          edit(next ? setEdits(view, path, "auto", scope.target) : clearEdits(path))
        }
      />
    </FieldRow>
  );
}

function DependsOn({
  view,
  edit,
  readOnly,
  name,
  value,
}: Common & { name: string; value: string[] }) {
  const path = ["services", name, "dependsOn"];
  const scope = useFieldScope(view, path, "shared", value.length ? value : undefined, edit);
  const others = Object.keys(view.services).filter((other) => other !== name);
  if (others.length === 0 && value.length === 0) return null;
  const toggle = (other: string) => {
    const next = value.includes(other) ? value.filter((v) => v !== other) : [...value, other];
    edit(next.length ? setEdits(view, path, next, scope.target) : clearEdits(path));
  };
  return (
    <FieldRow label="Depends on" scope={scope} readOnly={readOnly}>
      <div className="flex flex-wrap gap-1">
        {[...new Set([...others, ...value])].map((other) => (
          <button
            key={other}
            type="button"
            aria-pressed={value.includes(other)}
            disabled={readOnly}
            onClick={() => toggle(other)}
            className={cn(
              "h-6 rounded-control border px-2 text-[0.75rem] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              value.includes(other)
                ? "border-foreground/30 bg-foreground/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {other}
          </button>
        ))}
      </div>
    </FieldRow>
  );
}

function EnvRow({ view, edit, readOnly, path, value }: Common & { path: string[]; value: string }) {
  const key = path[3]!;
  const scope = useFieldScope(view, path, "shared", value, edit);
  return (
    <div className={cn("flex items-center gap-2 pl-2", localEdge(scope.local))}>
      <span className="w-40 shrink-0 truncate font-mono text-[0.75rem]" title={key}>
        {key}
      </span>
      <DraftInput
        label={`${key} value`}
        value={value}
        disabled={readOnly}
        mono
        onCommit={(text) => edit(setEdits(view, path, text, scope.target))}
      />
      <ScopeToggle
        label={`Save ${key} to`}
        value={scope.target}
        disabled={readOnly}
        onChange={scope.pick}
      />
      {!readOnly && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Remove ${key}`}
          className="size-7 shrink-0 text-muted-foreground"
          onClick={() => edit(clearEdits(path))}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

function EnvTable({
  view,
  edit,
  readOnly,
  name,
  env,
}: Common & { name: string; env: Record<string, string> }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [target, setTarget] = useState<ProjectConfigScope>("local");
  const add = () => {
    edit(setEdits(view, ["services", name, "env", key.trim()], value, target));
    setKey("");
    setValue("");
  };
  return (
    <div className="flex flex-col gap-1.5 py-1.5">
      <div className="text-[0.75rem] font-medium text-foreground">Environment</div>
      {Object.entries(env).map(([envKey, envValue]) => (
        <EnvRow
          key={envKey}
          view={view}
          edit={edit}
          readOnly={readOnly}
          path={["services", name, "env", envKey]}
          value={envValue}
        />
      ))}
      {!readOnly && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (key.trim()) add();
          }}
        >
          <input
            aria-label="New variable name"
            placeholder="NAME"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className={cn(settingsControl, "w-40 shrink-0 font-mono text-[0.75rem]")}
          />
          <input
            aria-label="New variable value"
            placeholder="value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className={cn(settingsControl, "w-full font-mono text-[0.75rem]")}
          />
          <ScopeToggle label="Save new variable to" value={target} onChange={setTarget} />
          <Button
            type="submit"
            size="icon"
            variant="ghost"
            aria-label="Add variable"
            disabled={!key.trim()}
            className="size-7 shrink-0 text-muted-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
        </form>
      )}
    </div>
  );
}
