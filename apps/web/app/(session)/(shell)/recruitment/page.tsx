import type { Metadata } from "next";
import { RecruitmentBoard } from "@/components/workforce/RecruitmentBoard";

export const metadata: Metadata = { title: "Recruitment · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function RecruitmentPage() {
  return <RecruitmentBoard />;
}
