"use client";

import { RotateCcw, UserMinus } from "lucide-react";
import type { PickRow, Violation } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GroupLabel, Level, SMALL_BUTTON, SourceIcon, Violations } from "./parts";

/** Desktop columns; on a phone each row is a card and the cells wrap. */
const GRID =
  "sm:grid sm:grid-cols-[1.5rem_minmax(12rem,1.8fr)_2rem_minmax(7rem,1fr)_6rem_minmax(3rem,1.2fr)_1rem_7rem]";

type Props = {
  picks: PickRow[];
  /** Whether this person may change the line (prepare permission, line still open). */
  editable: boolean;
  selected: ReadonlySet<string>;
  onToggle: (code: string) => void;
  onToggleAll: (all: boolean) => void;
  onRemove: (codes: string[]) => void;
  swapping: string | null;
  onSwap: (code: string | null) => void;
  onRestore: (code: string) => void;
  /** Why a restore was refused, by worker code. */
  restoreProblems: Record<string, Violation[]>;
  busy: boolean;
};

/** The workers chosen on one line as 40px rows, then the removed ones with Restore. */
export function PickList({
  picks,
  editable,
  selected,
  onToggle,
  onToggleAll,
  onRemove,
  swapping,
  onSwap,
  onRestore,
  restoreProblems,
  busy,
}: Props) {
  const active = picks.filter((p) => p.removed_reason === null);
  const removed = picks.filter((p) => p.removed_reason !== null);
  const allSelected = active.length > 0 && active.every((p) => selected.has(p.code));

  return (
    <div className="flex flex-col">
      {active.length > 0 && (
        <div className="overflow-hidden rounded-control border border-border">
          <div
            className={cn(
              GRID,
              "hidden items-center gap-x-2 border-b border-border bg-sunken px-3 py-1.5 text-xs font-medium text-muted",
            )}
          >
            <span>
              {editable && (
                <input
                  type="checkbox"
                  aria-label="Select every chosen worker"
                  checked={allSelected}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  className="size-4 accent-accent-hover"
                />
              )}
            </span>
            <span>Worker</span>
            <span>Level</span>
            <span>Availability</span>
            <span>Documents until</span>
            <span>Why</span>
            <span />
            <span />
          </div>
          <ul aria-label="Chosen workers" className="m-0 flex list-none flex-col p-0">
            {active.map((p) => (
              <li
                key={p.code}
                data-worker={p.code}
                className={cn(
                  GRID,
                  "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2 text-sm last:border-b-0 sm:min-h-10 sm:gap-x-2 sm:py-1",
                  p.violations.length > 0 && "border-l-2 border-l-danger bg-danger-soft",
                  swapping === p.code && "bg-warning-soft",
                )}
              >
                <span>
                  {editable && (
                    <input
                      type="checkbox"
                      aria-label={`Select ${p.name}`}
                      checked={selected.has(p.code)}
                      onChange={() => onToggle(p.code)}
                      className="size-4 accent-accent-hover"
                    />
                  )}
                </span>
                <span className="min-w-0 truncate font-medium">
                  {p.name}{" "}
                  <span className="font-mono text-xs font-normal text-subtle">{p.code}</span>
                </span>
                <span className="text-xs text-muted">
                  <Level level={p.level} />
                </span>
                <span className="min-w-0">
                  {p.group ? (
                    <GroupLabel
                      group={p.group}
                      fromProject={p.from_project}
                      startsOn={p.starts_on}
                    />
                  ) : (
                    <span className="text-xs text-subtle">Not in the pool</span>
                  )}
                </span>
                <span className="text-xs text-muted">
                  <span className="sm:hidden">Documents until </span>
                  {p.documents_until ? formatDate(p.documents_until) : "No end date"}
                </span>
                <span
                  title={p.reason ?? undefined}
                  className="w-full min-w-0 truncate text-xs text-muted sm:w-auto"
                >
                  {p.reason ?? ""}
                </span>
                <SourceIcon source={p.source} />
                <span className="ml-auto flex items-center justify-end gap-1 sm:ml-0">
                  {editable &&
                    (swapping === p.code ? (
                      <button type="button" className={SMALL_BUTTON} onClick={() => onSwap(null)}>
                        Cancel swap
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={SMALL_BUTTON}
                          disabled={busy}
                          aria-label={`Swap ${p.name}`}
                          onClick={() => onSwap(p.code)}
                        >
                          Swap
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`Remove ${p.name}`}
                          title="Remove from this line"
                          onClick={() => onRemove([p.code])}
                          className="press grid size-7 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-60"
                        >
                          <UserMinus className="size-4" aria-hidden="true" />
                        </button>
                      </>
                    ))}
                </span>
                {swapping === p.code && (
                  <span className="w-full text-xs text-warning-text sm:col-span-full">
                    Choose who takes {p.name}’s place in the pool.
                  </span>
                )}
                {p.violations.length > 0 && (
                  <div className="w-full sm:col-span-full">
                    <Violations items={p.violations} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {removed.length > 0 && (
        <section aria-label="Removed workers" className="mt-3 flex flex-col gap-1">
          <h4 className="m-0 text-xs font-medium text-muted">Removed ({removed.length})</h4>
          <ul className="m-0 flex list-none flex-col p-0">
            {removed.map((p) => (
              <li
                key={p.code}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-1.5 text-sm last:border-b-0"
              >
                <span className="text-muted line-through decoration-subtle">
                  {p.name} <span className="font-mono text-xs">{p.code}</span>
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-xs text-subtle"
                  title={p.removed_reason ?? ""}
                >
                  {p.removed_reason}
                </span>
                {editable && (
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={busy}
                    aria-label={`Restore ${p.name}`}
                    onClick={() => onRestore(p.code)}
                  >
                    <RotateCcw className="size-3.5" aria-hidden="true" />
                    Restore
                  </button>
                )}
                {restoreProblems[p.code] && (
                  <div role="alert" className="w-full">
                    <Violations items={restoreProblems[p.code]} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
