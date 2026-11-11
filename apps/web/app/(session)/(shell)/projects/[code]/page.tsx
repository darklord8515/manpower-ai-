import type { Metadata } from "next";
import { ProjectWorkforce } from "@/components/workforce/ProjectWorkforce";

export const metadata: Metadata = { title: "Project · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default async function ProjectPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ProjectWorkforce code={code} />;
}
