import type { Metadata } from "next";
import { Suspense } from "react";
import { PeopleScreen } from "@/components/workforce/PeopleScreen";

export const metadata: Metadata = { title: "People · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function PeoplePage() {
  // useSearchParams (a person a link points at) needs a Suspense boundary.
  return (
    <Suspense>
      <PeopleScreen />
    </Suspense>
  );
}
