"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlhamraMark } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import { navFor, type NavItem } from "./nav";

type Props = {
  items: NavItem[];
  collapsed?: boolean;
  /** Called after a link is chosen (closes the mobile drawer). */
  onNavigate?: () => void;
};

/**
 * The black sidebar. The same component is the desktop sidebar and the mobile drawer.
 * The red bar belongs to the current page and slides to the next one when you move.
 */
export function SidebarContent({ items, collapsed = false, onNavigate }: Props) {
  const pathname = usePathname();
  const current = navFor(pathname);
  const groups = [...new Set(items.map((item) => item.group))];

  return (
    <div className="flex h-full flex-col bg-(--sb-bg) text-(--sb-text)">
      <div
        className={cn(
          "flex h-14 shrink-0 items-center gap-2 border-b border-(--sb-border) px-4",
          collapsed && "justify-center px-0",
        )}
      >
        <AlhamraMark className="h-8 w-7 text-(--sb-text)" label={collapsed ? "Alhamra" : ""} />
        {!collapsed && <span className="text-sm font-semibold tracking-[0.04em]">HAMRA AI</span>}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group) => (
          <div key={group || "main"} className="not-first:mt-4">
            {group && !collapsed && (
              <p className="px-2 pb-1 text-xs tracking-[0.04em] text-(--sb-muted) uppercase">
                {group}
              </p>
            )}
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {items
                .filter((item) => item.group === group)
                .map((item) => {
                  const active = current?.id === item.id;
                  const Icon = item.icon;
                  return (
                    <li key={item.id} className="relative">
                      {active && (
                        <motion.span
                          layoutId="nav-bar"
                          aria-hidden="true"
                          className="absolute top-2 -left-2 bottom-2 w-0.75 rounded-r-sm bg-(--sb-accent)"
                          transition={{ type: "spring", stiffness: 520, damping: 42 }}
                        />
                      )}
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? item.label : undefined}
                        className={cn(
                          "flex h-8 items-center gap-3 rounded-control px-2 text-sm font-medium whitespace-nowrap transition-colors",
                          active
                            ? "bg-(--sb-active) text-(--sb-text)"
                            : "text-(--sb-muted) hover:bg-(--sb-hover) hover:text-(--sb-text)",
                          collapsed && "justify-center px-0",
                        )}
                      >
                        <Icon className="size-4.5 shrink-0" aria-hidden="true" />
                        {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
