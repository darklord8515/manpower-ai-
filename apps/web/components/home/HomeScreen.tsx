"use client";

import { useUser } from "@/components/auth/AuthProvider";
import { WorkforceHome } from "@/components/workforce/WorkforceHome";
import { Hero } from "./Hero";

const ROLE_LABEL: Record<string, string> = {
  hr_manager: "HR Manager",
  hr_executive: "HR Executive",
  ceo: "MD / CEO",
};

/** Home for HR and the MD/CEO: planned against ongoing, what to hire, and what the AI did. */
export function HomeScreen() {
  const user = useUser();
  const roleLabel = ROLE_LABEL[user.roles[0] ?? ""] ?? "";
  return (
    <div className="flex flex-col gap-4">
      <Hero fullName={user.full_name} roleLabel={roleLabel} />
      <WorkforceHome />
    </div>
  );
}
