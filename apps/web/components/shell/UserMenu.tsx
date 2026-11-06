"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, LogOut, Monitor, Moon, Sun, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { useAuth, useUser } from "@/components/auth/AuthProvider";
import { applyThemeChoice } from "@/components/theme/ThemeToggle";
import type { DemoRole } from "@/lib/api-types";
import type { DayPeriod } from "@/lib/greeting";
import { previewPeriod, setPreviewPeriod } from "@/lib/use-day-period";
import { cn } from "@/lib/utils";

const ROLE_NAMES: Record<string, string> = {
  hr_manager: "HR Manager",
  hr_executive: "HR Executive",
  ceo: "MD / CEO",
};

const ITEM =
  "flex h-8 cursor-default items-center gap-2 rounded-control px-2 text-sm outline-none select-none data-highlighted:bg-hover data-disabled:opacity-50";
const LABEL = "px-2 pt-2 pb-1 text-xs font-medium text-subtle";

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

const subscribePreview = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

export function UserMenu() {
  const user = useUser();
  const { signOut, demoSignIn } = useAuth();
  const router = useRouter();
  const preview = useSyncExternalStore(subscribePreview, previewPeriod, () => null);
  const role = ROLE_NAMES[user.roles[0] ?? ""] ?? user.roles[0] ?? "";

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`Account menu for ${user.full_name}`}
        className="press grid size-8 place-items-center rounded-full border border-border-strong bg-sunken text-xs font-semibold text-muted transition-[transform,background-color] duration-120 hover:bg-hover data-[state=open]:bg-hover"
      >
        {initialsOf(user.full_name)}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          className="menu-content z-90 min-w-60 rounded-card border border-border bg-raised p-1 shadow-(--shadow-pop)"
        >
          <div className="px-2 py-2">
            <p className="text-sm font-medium">{user.full_name}</p>
            <p className="text-xs text-muted">{role}</p>
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />

          <Menu.Label className={LABEL}>Theme</Menu.Label>
          <Menu.Item className={ITEM} onSelect={() => applyThemeChoice("light")}>
            <Sun className="size-4" aria-hidden="true" /> Light
          </Menu.Item>
          <Menu.Item className={ITEM} onSelect={() => applyThemeChoice("dark")}>
            <Moon className="size-4" aria-hidden="true" /> Dark
          </Menu.Item>
          <Menu.Item className={ITEM} onSelect={() => applyThemeChoice("system")}>
            <Monitor className="size-4" aria-hidden="true" /> Match this device
          </Menu.Item>

          {user.demo_mode && (
            <>
              <Menu.Separator className="my-1 h-px bg-border" />
              <Menu.Label className={LABEL}>Demo tools (for the presenter)</Menu.Label>
              <Menu.RadioGroup
                value={preview ?? "real"}
                onValueChange={(value) =>
                  setPreviewPeriod(value === "real" ? null : (value as DayPeriod))
                }
              >
                {(
                  [
                    ["real", "Time of day: real time"],
                    ["morning", "Preview morning"],
                    ["afternoon", "Preview afternoon"],
                    ["evening", "Preview evening"],
                  ] as const
                ).map(([value, label]) => (
                  <Menu.RadioItem key={value} value={value} className={cn(ITEM, "pl-7")}>
                    <Menu.ItemIndicator className="absolute left-2">
                      <Check className="size-4" aria-hidden="true" />
                    </Menu.ItemIndicator>
                    {label}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
              <Menu.Label className={LABEL}>Sign in as</Menu.Label>
              {(Object.keys(ROLE_NAMES) as DemoRole[])
                .filter((r) => r !== user.roles[0])
                .map((r) => (
                  <Menu.Item
                    key={r}
                    className={ITEM}
                    onSelect={() => {
                      void demoSignIn(r).then(() => router.replace("/"));
                    }}
                  >
                    <Users className="size-4" aria-hidden="true" /> {ROLE_NAMES[r]}
                  </Menu.Item>
                ))}
            </>
          )}

          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item className={ITEM} onSelect={() => void signOut()}>
            <LogOut className="size-4" aria-hidden="true" /> Sign out
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
