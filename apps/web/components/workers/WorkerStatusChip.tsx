import { Building2, CircleAlert, CircleCheck, Clock } from "lucide-react";
import { StatusChip, type Tone } from "@/components/ui/StatusChip";
import type { WorkerStatus } from "@/lib/api-types";

const STATUS: Record<WorkerStatus, { tone: Tone; icon: typeof Clock; label: string }> = {
  available: { tone: "success", icon: CircleCheck, label: "Available" },
  deployed: { tone: "neutral", icon: Building2, label: "On a project" },
  mobilizing: { tone: "info", icon: Clock, label: "Mobilizing" },
  demobilizing: { tone: "info", icon: Clock, label: "Leaving a project" },
  unavailable: { tone: "warning", icon: CircleAlert, label: "Not available" },
};

export const STATUS_LABEL: Record<WorkerStatus, string> = {
  available: STATUS.available.label,
  deployed: STATUS.deployed.label,
  mobilizing: STATUS.mobilizing.label,
  demobilizing: STATUS.demobilizing.label,
  unavailable: STATUS.unavailable.label,
};

export function WorkerStatusChip({ status }: { status: WorkerStatus }) {
  const { tone, icon, label } = STATUS[status];
  return <StatusChip tone={tone} icon={icon} label={label} />;
}
