import type { Metadata } from "next";
import { DocumentsScreen } from "@/components/documents/DocumentsScreen";

export const metadata: Metadata = { title: "Documents · CONSTRUCTIQ" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function DocumentsPage() {
  return <DocumentsScreen />;
}
