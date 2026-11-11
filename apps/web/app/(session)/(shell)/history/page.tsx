import type { Metadata } from "next";
import { HistoryScreen } from "@/components/workforce/HistoryScreen";

export const metadata: Metadata = { title: "History · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function HistoryPage() {
  return <HistoryScreen />;
}
