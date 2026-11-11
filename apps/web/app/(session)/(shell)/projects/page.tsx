import type { Metadata } from "next";
import { ProjectsList } from "@/components/workforce/ProjectsList";

export const metadata: Metadata = { title: "Projects · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default function ProjectsPage() {
  return <ProjectsList />;
}
