import type { Metadata } from "next";
import { ForecastScreen } from "@/components/projects/ForecastScreen";

export const metadata: Metadata = { title: "Manpower forecast · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default async function ForecastPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ForecastScreen code={code} />;
}
