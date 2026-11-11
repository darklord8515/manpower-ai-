import {
  Bot,
  Building2,
  CalendarDays,
  History,
  LayoutDashboard,
  ListTodo,
  UserPlus,
  UserSearch,
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
    id: "todo",
    label: "To-do",
    href: "/todo",
    icon: ListTodo,
    group: "",
    requires: "alert:read",
  },
  {
    id: "calendar",
    label: "Calendar",
    href: "/calendar",
    icon: CalendarDays,
    group: "",
    requires: "project:read",
  },
  {
    id: "assistant",
    label: "Virtual HR",
    href: "/assistant",
    icon: Bot,
    group: "",
    requires: "ai:use",
  },
  {
    id: "workers",
    label: "People",
    href: "/workers",
    icon: Users,
    group: "Workforce",
    requires: "employee:read",
  },
  {
    id: "projects",
    label: "Projects",
    href: "/projects",
    icon: Building2,
    group: "Workforce",
    requires: "project:read",
  },
  {
    id: "recruitment",
    label: "Recruitment",
    href: "/recruitment",
    icon: UserPlus,
    group: "Workforce",
    requires: "recruitment:read",
  },
  {
    id: "history",
    label: "History",
    href: "/history",
    icon: History,
    group: "Workforce",
    requires: "employee:read",
  },
  {
    id: "applicants",
    label: "Applicants",
    href: "/applicants",
    icon: UserSearch,
    group: "Workforce",
    requires: "staffing:read",
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
