import { Info, OctagonX, TriangleAlert } from "lucide-react";
import { StatusChip } from "./StatusChip";

export type Severity = "critical" | "action_needed" | "info";

export const SEVERITY: Record<Severity, { label: string; rank: number }> = {
  critical: { label: "Critical", rank: 0 },
  action_needed: { label: "Action needed", rank: 1 },
  info: { label: "Info", rank: 2 },
};

/** Severity = icon + label + colour, never colour alone (design-direction.md → Action Center). */
export function SeverityChip({ severity }: { severity: Severity }) {
  const label = SEVERITY[severity].label;
  if (severity === "critical") return <StatusChip tone="danger" icon={OctagonX} label={label} />;
  if (severity === "action_needed")
    return <StatusChip tone="warning" icon={TriangleAlert} label={label} />;
  return <StatusChip tone="info" icon={Info} label={label} />;
}
