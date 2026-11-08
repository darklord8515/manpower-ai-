import type { Metadata } from "next";
import { Suspense } from "react";
import { AllocationScreen } from "@/components/allocation/AllocationScreen";

export const metadata: Metadata = { title: "Allocation · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function RequestsPage() {
  // useAddress (the request a link carried) needs a Suspense boundary.
  return (
    <Suspense>
      <AllocationScreen />
    </Suspense>
  );
}
