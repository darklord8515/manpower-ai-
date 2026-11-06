import type { Metadata } from "next";
import { RecruitmentScreen } from "@/components/recruitment/RecruitmentScreen";

export const metadata: Metadata = { title: "Recruitment · CONSTRUCTIQ" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function RecruitmentPage() {
  return <RecruitmentScreen />;
}
