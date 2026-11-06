import type { Metadata } from "next";
import { HomeScreen } from "@/components/home/HomeScreen";

export const metadata: Metadata = { title: "Home · CONSTRUCTIQ" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function HomePage() {
  return <HomeScreen />;
}
