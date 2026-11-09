import type { Metadata } from "next";
import { CalendarScreen } from "@/components/calendar/CalendarScreen";

export const metadata: Metadata = { title: "Calendar · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function CalendarPage() {
  return <CalendarScreen />;
}
