"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { BUTTON } from "@/components/ui/button-styles";
import { api } from "@/lib/api";
import type { CalendarEntry } from "@/lib/api-types";
import { GROUPS, KIND, gridFor, monthTitle, onDay } from "@/lib/calendar";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { DaySheet } from "./DaySheet";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHOWN = 3; // chips per day before "+N more"

/** The company calendar: leaves, holidays, project dates, documents, and what HR adds. */
export function CalendarScreen() {
  const today = useLoad(() => api.summary().then((s) => s.today), "today");
  const [cursor, setCursor] = useState<{ year: number; month: number } | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The server's date (it can be the demo date) decides which month opens first.
  const shown = useMemo(
    () =>
      cursor ??
      (today.data
        ? { year: Number(today.data.slice(0, 4)), month: Number(today.data.slice(5, 7)) - 1 }
        : null),
    [cursor, today.data],
  );
  const cells = useMemo(() => (shown ? gridFor(shown.year, shown.month) : []), [shown]);
  const range = cells.length ? { start: cells[0].iso, end: cells[41].iso } : null;
  const view = useLoad(
    () => api.calendar(range!.start, range!.end),
    `${range?.start}:${range?.end}`,
    range !== null,
  );

  const visible = useMemo(() => {
    const hidden = new Set(GROUPS.filter((g) => off.has(g.id)).flatMap((g) => g.kinds));
    return (view.data?.entries ?? []).filter((e) => !hidden.has(e.kind));
  }, [view.data, off]);

  function move(by: number) {
    if (!shown) return;
    const d = new Date(shown.year, shown.month + by, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  }

  if (today.error)
    return (
      <ErrorState title="Couldn’t open the calendar" onRetry={today.retry}>
        {today.error}
      </ErrorState>
    );

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Calendar</h1>
          <p className="m-0 text-sm text-muted">
            Leaves, holidays, project dates, documents and HR events in one place.
            {view.data?.can_edit ? " Open a day to add an event or a leave." : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={BUTTON}
            onClick={() => move(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
          </button>
          <h2 className="m-0 min-w-36 text-center text-md font-semibold" aria-live="polite">
            {shown ? monthTitle(shown.year, shown.month) : "…"}
          </h2>
          <button type="button" className={BUTTON} onClick={() => move(1)} aria-label="Next month">
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
          <button type="button" className={BUTTON} onClick={() => setCursor(null)}>
            Today
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Show on the calendar">
        {GROUPS.map((g) => {
          const on = !off.has(g.id);
          const kind = g.kinds[0];
          return (
            <button
              key={g.id}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setOff((prev) => {
                  const next = new Set(prev);
                  if (next.has(g.id)) next.delete(g.id);
                  else next.add(g.id);
                  return next;
                })
              }
              className={cn(
                "press inline-flex h-8 items-center gap-2 rounded-full border border-border-strong px-3 text-xs font-medium transition-colors",
                on ? "bg-surface" : "bg-sunken text-subtle line-through",
              )}
            >
              <span className={cn("size-2.5 rounded-full", KIND[kind].dot)} aria-hidden="true" />
              {g.label}
            </button>
          );
        })}
      </div>

      {notice && (
        <p
          role="status"
          className="m-0 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
        >
          {notice}
        </p>
      )}

      {view.error ? (
        <ErrorState title="Couldn’t load the calendar" onRetry={view.retry}>
          {view.error}
        </ErrorState>
      ) : !shown || view.loading ? (
        <SkeletonLoader label="Loading the calendar" variant="rows" count={6} />
      ) : (
        <div
          role="grid"
          aria-label={monthTitle(shown.year, shown.month)}
          className="overflow-hidden rounded-card border border-border bg-surface"
        >
          <div
            role="row"
            className="grid grid-cols-7 border-b border-border bg-sunken text-xs text-muted"
          >
            {WEEKDAYS.map((d) => (
              <div key={d} role="columnheader" className="px-2 py-2 text-center font-medium">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {cells.map((cell) => {
              const entries = onDay(visible, cell.iso);
              const isToday = cell.iso === view.data?.today;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  role="gridcell"
                  onClick={() => setOpen(cell.iso)}
                  aria-label={`${cell.iso}, ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
                  className={cn(
                    "flex min-h-14 flex-col items-stretch gap-1 border-t border-r border-border p-1.5 text-left transition-colors hover:bg-hover focus-visible:z-10 sm:min-h-28",
                    !cell.inMonth && "bg-sunken/60 text-subtle",
                    cell.weekend && cell.inMonth && "bg-sunken/40",
                  )}
                >
                  <span
                    className={cn(
                      "grid size-6 place-items-center self-start rounded-full text-xs tabular-nums",
                      isToday && "bg-accent font-semibold text-accent-on",
                    )}
                  >
                    {cell.day}
                  </span>
                  <span className="hidden flex-col gap-1 sm:flex">
                    {entries.slice(0, SHOWN).map((e) => (
                      <Chip key={e.id} entry={e} />
                    ))}
                    {entries.length > SHOWN && (
                      <span className="px-1 text-xs text-muted">
                        +{entries.length - SHOWN} more
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap gap-0.5 sm:hidden" aria-hidden="true">
                    {entries.slice(0, 4).map((e) => (
                      <span key={e.id} className={cn("size-1.5 rounded-full", KIND[e.kind].dot)} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <DaySheet
        day={open}
        entries={open ? onDay(visible, open) : []}
        canEdit={Boolean(view.data?.can_edit)}
        onChanged={(text) => {
          setNotice(text);
          view.retry();
        }}
        onClose={() => setOpen(null)}
      />
    </div>
  );
}

function Chip({ entry }: { entry: CalendarEntry }) {
  return (
    <span
      title={entry.title}
      className={cn("truncate rounded-control px-1.5 py-0.5 text-xs", KIND[entry.kind].chip)}
    >
      {entry.title}
    </span>
  );
}
