"use client";

import { Building2, CalendarClock, HardHat, TriangleAlert, Users } from "lucide-react";
import { useUser } from "@/components/auth/AuthProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import { KpiTile } from "@/components/ui/KpiTile";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import type { Summary } from "@/lib/api-types";
import { Briefing, ExecutiveSections } from "./ExecutiveSections";
import { HomeGrid } from "./HomeGrid";
import { Hero } from "./Hero";
import { useHomeData } from "./useHomeData";

const ROLE_LABEL: Record<string, string> = {
  hr_manager: "HR Manager",
  hr_executive: "HR Executive",
  ceo: "MD / CEO",
};

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function HrKpis({ summary }: { summary: Summary }) {
  const { workforce, documents } = summary;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        label="Deployed"
        icon={HardHat}
        value={workforce.deployed}
        of={`of ${workforce.total}`}
        detail={`${plural(workforce.mobilizing, "person", "people")} mobilizing`}
      />
      <KpiTile
        label="Available now"
        icon={Users}
        value={workforce.available}
        detail="Free to assign"
      />
      <KpiTile
        label="Mobilizing"
        icon={CalendarClock}
        value={workforce.mobilizing}
        detail="Getting ready to start"
      />
      <KpiTile
        label="Documents running out"
        icon={TriangleAlert}
        value={documents.d30}
        detail={documents.expired ? `${documents.expired} already expired` : "In the next 30 days"}
      />
    </div>
  );
}

function CeoKpis({ summary }: { summary: Summary }) {
  const { workforce, documents, projects } = summary;
  const active = projects.filter((p) => p.status === "active");
  const shortProjects = active.filter((p) => p.planned > p.deployed).length;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiTile
        label="Active projects"
        icon={Building2}
        value={active.length}
        detail={`${projects.length - active.length} in planning`}
      />
      <KpiTile
        label="Deployed"
        icon={HardHat}
        value={workforce.deployed}
        of={`of ${workforce.total}`}
        detail={`${workforce.available} available now`}
      />
      <KpiTile
        label="People short"
        icon={Users}
        value={summary.short_total}
        detail={`Across ${plural(shortProjects, "project")}`}
      />
      <KpiTile
        label="Documents need attention"
        icon={TriangleAlert}
        value={documents.expired + documents.d30}
        detail={`${documents.expired} expired, ${documents.d30} in 30 days`}
      />
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <div className="skeleton h-44 rounded-card md:h-52" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonLoader key={i} label="Loading figure" variant="tile" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="skeleton h-80 rounded-card lg:col-span-2" />
        <div className="skeleton h-80 rounded-card" />
      </div>
    </div>
  );
}

/** Home for HR (Manager and Executive) and the MD/CEO, on live data from the API. */
export function HomeScreen() {
  const user = useUser();
  const isCeo = user.landing === "executive";
  const { state, retry } = useHomeData(!isCeo);
  const roleLabel = ROLE_LABEL[user.roles[0] ?? ""] ?? "";

  if (state.status === "loading") {
    return (
      <>
        <Hero fullName={user.full_name} roleLabel={roleLabel} />
        <div className="mt-4">
          <HomeSkeleton />
        </div>
      </>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <Hero fullName={user.full_name} roleLabel={roleLabel} />
        <div className="mt-4 rounded-card border border-border bg-surface p-5">
          <ErrorState title="Couldn’t load Home" onRetry={retry}>
            {state.message}
          </ErrorState>
        </div>
      </>
    );
  }

  const { summary, due } = state.data;
  return (
    <div className="flex flex-col gap-4">
      <Hero fullName={user.full_name} roleLabel={roleLabel} insight={summary.insight} />
      {isCeo ? <CeoKpis summary={summary} /> : <HrKpis summary={summary} />}
      {isCeo ? <ExecutiveSections /> : <Briefing />}
      <HomeGrid kind={isCeo ? "executive" : "hr"} summary={summary} due={due} />
    </div>
  );
}
