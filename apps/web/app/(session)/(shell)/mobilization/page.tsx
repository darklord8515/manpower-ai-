import type { Metadata } from "next";
import { MobilizationBoard } from "@/components/workforce/MobilizationBoard";

export const metadata: Metadata = { title: "Mobilization · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function MobilizationPage() {
  return <MobilizationBoard />;
}
