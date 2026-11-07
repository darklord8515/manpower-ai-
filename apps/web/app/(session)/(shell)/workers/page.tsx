import type { Metadata } from "next";
import { Suspense } from "react";
import { WorkersScreen } from "@/components/workers/WorkersScreen";

export const metadata: Metadata = { title: "Workers · CONSTRUCTIQ" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function WorkersPage() {
  // useAddress (the filters and worker a link carried) needs a Suspense boundary.
  return (
    <Suspense>
      <WorkersScreen />
    </Suspense>
  );
}
