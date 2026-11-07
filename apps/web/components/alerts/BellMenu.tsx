"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Bell, CircleCheck, ListTodo, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useUser } from "@/components/auth/AuthProvider";
import { SeverityChip } from "@/components/ui/SeverityChip";
import { ageText, lastRunText } from "@/lib/alerts";
import { useAlertSummary } from "./use-alert-summary";

const ITEM =
  "flex cursor-default flex-col gap-1 rounded-control px-2 py-2 text-sm outline-none select-none data-highlighted:bg-hover";

/** The bell: how many alerts need attention, and the five most urgent. */
export function BellMenu() {
  const user = useUser();
  const enabled = user.permissions.includes("alert:read");
  const { data, error, retry } = useAlertSummary(enabled);
  if (!enabled) return null;
  const n = data?.needs_attention ?? 0;

  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={data ? `Alerts: ${n} need${n === 1 ? "s" : ""} attention` : "Alerts"}
        className="press relative grid size-8 place-items-center rounded-control text-muted transition-[transform,background-color,color] duration-120 hover:bg-hover hover:text-fg data-[state=open]:bg-hover"
      >
        <Bell className="size-4.5" aria-hidden="true" />
        {n > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] leading-none font-semibold text-accent-on tabular-nums"
          >
            {n > 99 ? "99+" : n}
          </span>
        )}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          className="menu-content z-90 w-[min(380px,calc(100vw-2rem))] rounded-card border border-border bg-raised p-1 shadow-(--shadow-pop)"
        >
          <div className="flex items-baseline justify-between px-2 pt-2 pb-1">
            <p className="m-0 text-sm font-semibold">Needs attention</p>
            {data && (
              <p className="m-0 text-xs text-muted">
                {n} {n === 1 ? "alert" : "alerts"}
              </p>
            )}
          </div>
          <Menu.Separator className="my-1 h-px bg-border" />

          {error && !data && (
            <Menu.Item
              className={ITEM}
              onSelect={(event) => {
                event.preventDefault();
                retry();
              }}
            >
              <span className="text-muted">Couldn’t load the alerts. {error}</span>
              <span className="inline-flex items-center gap-1 font-medium">
                <RefreshCw className="size-3.5" aria-hidden="true" /> Retry
              </span>
            </Menu.Item>
          )}
          {!data && !error && (
            <div className="flex flex-col gap-2 p-2" role="status" aria-label="Loading alerts">
              <div className="skeleton h-10 w-full" />
              <div className="skeleton h-10 w-full" />
            </div>
          )}
          {data && data.top.length === 0 && (
            <p className="m-0 flex items-center gap-2 px-2 py-3 text-sm text-muted">
              <CircleCheck className="size-4 text-success-text" aria-hidden="true" />
              Nothing needs attention.
            </p>
          )}
          {data?.top.map((alert) => (
            <Menu.Item key={alert.id} asChild className={ITEM}>
              <Link href={`/todo?alert=${alert.id}`}>
                <span className="flex items-center gap-2">
                  <SeverityChip severity={alert.severity} />
                  <span className="text-xs text-subtle">{ageText(alert.raised_at, data.now)}</span>
                </span>
                <span className="line-clamp-2 font-medium">{alert.title}</span>
              </Link>
            </Menu.Item>
          ))}

          <Menu.Separator className="my-1 h-px bg-border" />
          <Menu.Item asChild className={`${ITEM} flex-row items-center gap-2 font-medium`}>
            <Link href="/todo">
              <ListTodo className="size-4" aria-hidden="true" /> Open To-do
            </Link>
          </Menu.Item>
          {data && (
            <p className="m-0 px-2 pt-1 pb-2 text-xs text-subtle">{lastRunText(data.last_run)}</p>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
