import type { Metadata } from "next";
import { AllocationScreen } from "@/components/allocation/AllocationScreen";

export const metadata: Metadata = { title: "Allocation · CONSTRUCTIQ" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function RequestsPage() {
  return <AllocationScreen />;
}
