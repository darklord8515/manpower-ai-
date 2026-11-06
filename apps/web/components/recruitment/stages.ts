import type { RecruitmentStage } from "@/lib/api-types";
import type { Tone } from "@/components/ui/StatusChip";

/** The pipeline in the words the client's own trackers use. */
export const STAGE_NAME: Record<RecruitmentStage, string> = {
  open: "Future requirement",
  sourcing: "Under recruitment",
  offer_issued: "Offer issued",
  visa_processing: "Visa processing",
  arrived: "Arrived, pending deployment",
  filled: "Active",
  cancelled: "Cancelled",
};

export const STAGE_TONE: Record<RecruitmentStage, Tone> = {
  open: "neutral",
  sourcing: "info",
  offer_issued: "info",
  visa_processing: "info",
  arrived: "warning",
  filled: "success",
  cancelled: "neutral",
};

const ORDER: RecruitmentStage[] = [
  "open",
  "sourcing",
  "offer_issued",
  "visa_processing",
  "arrived",
  "filled",
];

/** The one step a request can take forward, or null once it is active or cancelled. */
export function nextStage(stage: RecruitmentStage): RecruitmentStage | null {
  const i = ORDER.indexOf(stage);
  return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null;
}

export const isOpenStage = (stage: RecruitmentStage) => stage !== "filled" && stage !== "cancelled";
