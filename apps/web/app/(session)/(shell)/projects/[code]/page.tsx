import type { Metadata } from "next";
import { ProjectOverviewScreen } from "@/components/projects/ProjectOverviewScreen";

export const metadata: Metadata = { title: "Project overview · HAMRA AI" };

// Personal, signed-in data loaded in the browser (see app/(session)/layout.tsx).
export const instant = false;

export default async function ProjectPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <ProjectOverviewScreen code={code} />;
}
