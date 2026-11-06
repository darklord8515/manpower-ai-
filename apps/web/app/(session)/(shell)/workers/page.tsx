import type { Metadata } from "next";
import { WorkersScreen } from "@/components/workers/WorkersScreen";

export const metadata: Metadata = { title: "Workers · CONSTRUCTIQ" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function WorkersPage() {
  return <WorkersScreen />;
}
