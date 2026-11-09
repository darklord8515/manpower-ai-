import type { Metadata } from "next";
import { ApplicantsScreen } from "@/components/applicants/ApplicantsScreen";

export const metadata: Metadata = { title: "Applicants · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function ApplicantsPage() {
  return <ApplicantsScreen />;
}
