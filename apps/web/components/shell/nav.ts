import {
  Building2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  Truck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Section heading in the sidebar. Empty = no heading. */
  group: string;
  /** The permission that makes this item appear. The API still checks it on every request. */
  requires?: string;
};

/**
 * Only screens that exist are listed: the sidebar never links to something unbuilt.
 * Each new screen joins this list when it is built.
 */
export const NAV: NavItem[] = [
  { id: "home", label: "Home", href: "/", icon: LayoutDashboard, group: "" },
  {
    id: "workers",
    label: "Workers",
    href: "/workers",
    icon: Users,
    group: "People",
    requires: "employee:read",
  },
  {
    id: "documents",
    label: "Documents",
    href: "/documents",
    icon: FileText,
    group: "People",
    requires: "staffing:read",
  },
  {
    id: "projects",
    label: "Projects",
    href: "/projects",
    icon: Building2,
    group: "Work",
    requires: "project:read",
  },
  {
    id: "requests",
    label: "Allocation",
    href: "/requests",
    icon: ClipboardList,
    group: "Work",
    requires: "staffing:read",
  },
  {
    id: "mobilization",
    label: "Mobilization",
    href: "/mobilization",
    icon: Truck,
    group: "Work",
    requires: "mobilization:read",
  },
  {
    id: "recruitment",
    label: "Recruitment",
    href: "/recruitment",
    icon: UserPlus,
    group: "Work",
    requires: "recruitment:read",
  },
];

export function visibleNav(permissions: readonly string[]): NavItem[] {
  return NAV.filter((item) => !item.requires || permissions.includes(item.requires));
}

export function navFor(pathname: string): NavItem | undefined {
  return NAV.find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );
}
