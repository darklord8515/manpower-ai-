import type { Metadata } from "next";
import { ProjectsScreen } from "@/components/projects/ProjectsScreen";

export const metadata: Metadata = { title: "Projects · CONSTRUCTIQ" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function ProjectsPage() {
  return <ProjectsScreen />;
}
