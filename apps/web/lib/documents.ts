import type { Tone } from "@/components/ui/StatusChip";

/** What HR calls each document. The residency visa and the Emirates ID are one document. */
export const DOCUMENT_NAME: Record<string, string> = {
  residency_visa: "Residency visa",
  medical_fitness: "Medical fitness",
  labour_card: "Labour card",
  passport: "Passport",
  work_permit: "Work permit",
};

/** What the number on a document is called (the Emirates ID number sits on the residency visa). */
export const NUMBER_NAME: Record<string, string> = {
  residency_visa: "Emirates ID number",
  medical_fitness: "Certificate number",
  labour_card: "Labour card number",
  passport: "Passport number",
  work_permit: "Permit number",
};

/** How urgent a document is, from the days left. The words match the Home screen. */
export function timeLeft(days: number): { tone: Tone; label: string } {
  if (days < 0) return { tone: "danger", label: `Expired ${-days} d ago` };
  if (days <= 30) return { tone: "danger", label: `${days} d left` };
  if (days <= 60) return { tone: "warning", label: `${days} d left` };
  return { tone: "info", label: `${days} d left` };
}
