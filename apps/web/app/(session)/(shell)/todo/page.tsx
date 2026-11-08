import type { Metadata } from "next";
import { Suspense } from "react";
import { TodoScreen } from "@/components/alerts/TodoScreen";

export const metadata: Metadata = { title: "To-do · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function TodoPage() {
  // useAddress (the alert or severity a link carried) needs a Suspense boundary.
  return (
    <Suspense>
      <TodoScreen />
    </Suspense>
  );
}
