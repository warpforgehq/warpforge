import { Badge } from "@/components/ui/badge";
import type { SmithStatus } from "@/lib/smiths";

/** Working, waiting on you, idle, or held with its reason. */
export function SmithStatusBadge({ status }: { status: SmithStatus }) {
  if (status.kind === "held") {
    return (
      <Badge variant="warn" title={status.reasons.join("; ")} className="max-w-full truncate">
        Held · {status.reasons[0]}
      </Badge>
    );
  }
  if (status.kind === "waiting") {
    return (
      <Badge variant="warn" title={status.note} className="max-w-full truncate">
        Waiting on you
      </Badge>
    );
  }
  if (status.kind === "working") return <Badge variant="ok">Working</Badge>;
  return <Badge variant="outline">Idle</Badge>;
}
