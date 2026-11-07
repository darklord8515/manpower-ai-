import type { Metadata } from "next";
import { AssistantScreen } from "@/components/assistant/AssistantScreen";

export const metadata: Metadata = { title: "Virtual HR · CONSTRUCTIQ" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function AssistantPage() {
  return <AssistantScreen />;
}
