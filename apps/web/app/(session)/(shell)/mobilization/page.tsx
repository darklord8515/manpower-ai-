import type { Metadata } from "next";
import { MobilizationScreen } from "@/components/mobilization/MobilizationScreen";

export const metadata: Metadata = { title: "Mobilization · CONSTRUCTIQ" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function MobilizationPage() {
  return <MobilizationScreen />;
}
