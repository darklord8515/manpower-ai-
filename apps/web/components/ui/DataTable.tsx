"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";
import { revealProps } from "@/components/motion/Reveal";
import { cn } from "@/lib/utils";
import { ErrorState } from "./ErrorState";
import { SkeletonLoader } from "./SkeletonLoader";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Present = sortable. */
  sortValue?: (row: T) => string | number;
  align?: "left" | "right";
  className?: string;
};

type Props<T> = {
  caption: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Loading skeleton, error and empty states are part of the table, not left to each screen. */
  loading?: boolean;
  error?: { message: string; onRetry: () => void };
  empty: ReactNode;
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?: (selected: Set<string>) => void;
  /** Below 640px the table becomes a list of these cards. */
  mobileCard?: (row: T) => ReactNode;
  /**
   * Server-side sorting: pass the current sort and a change handler. The table then shows the rows
   * in the order given and only reports header clicks.
   */
  sort?: Sort;
  onSortChange?: (sort: Sort) => void;
};

export type Sort = { key: string; dir: "asc" | "desc" } | null;

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  loading,
  error,
  empty,
  selectable,
  selected,
  onSelectedChange,
  mobileCard,
  sort: controlledSort,
  onSortChange,
}: Props<T>) {
  const [localSort, setLocalSort] = useState<Sort>(null);
  const serverSorted = onSortChange !== undefined;
  const sort = serverSorted ? (controlledSort ?? null) : localSort;
  const setSort = serverSorted ? onSortChange : setLocalSort;

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort?.key);
    if (serverSorted || !sort || !column?.sortValue) return rows;
    const value = column.sortValue;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * factor;
    });
  }, [rows, columns, sort, serverSorted]);

  if (loading)
    return <SkeletonLoader label={`Loading ${caption}`} variant="rows" count={5} className="p-4" />;
  if (error) {
    return (
      <div className="p-5">
        <ErrorState title="Couldn’t load" onRetry={error.onRetry}>
          {error.message}
        </ErrorState>
      </div>
    );
  }
  if (rows.length === 0) return <>{empty}</>;

  const selection = selected ?? new Set<string>();
  const allSelected = sorted.length > 0 && sorted.every((row) => selection.has(rowKey(row)));

  function toggleAll() {
    onSelectedChange?.(allSelected ? new Set() : new Set(sorted.map(rowKey)));
  }
  function toggleOne(key: string) {
    const next = new Set(selection);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectedChange?.(next);
  }
  function cycleSort(key: string) {
    if (sort?.key !== key) setSort({ key, dir: "asc" });
    else if (sort.dir === "asc") setSort({ key, dir: "desc" });
    else setSort(null);
  }

  return (
    <>
      <div className={cn("overflow-x-auto", mobileCard && "hidden sm:block")}>
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {selectable && (
                <th scope="col" className="sticky top-0 w-10 bg-sunken px-3 py-2 first:pl-5">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                    className="size-4 accent-[var(--accent-hover)]"
                  />
                </th>
              )}
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      active
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : column.sortValue
                          ? "none"
                          : undefined
                    }
                    className={cn(
                      "sticky top-0 h-9 bg-sunken px-3 text-xs font-medium whitespace-nowrap text-muted first:pl-5 last:pr-5",
                      column.align === "right" && "text-right",
                      column.className,
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => cycleSort(column.key)}
                        className="inline-flex items-center gap-1 rounded-control hover:text-fg"
                      >
                        {column.header}
                        {active ? (
                          sort.dir === "asc" ? (
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          ) : (
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          )
                        ) : (
                          <ChevronsUpDown className="size-3.5 opacity-50" aria-hidden="true" />
                        )}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, index) => {
              const key = rowKey(row);
              return (
                <motion.tr
                  key={key}
                  {...revealProps(index)}
                  data-selected={selection.has(key) || undefined}
                  className="border-t border-border transition-colors hover:bg-hover data-[selected]:bg-accent-soft"
                >
                  {selectable && (
                    <td className="w-10 px-3 first:pl-5">
                      <input
                        type="checkbox"
                        checked={selection.has(key)}
                        onChange={() => toggleOne(key)}
                        aria-label={`Select row ${key}`}
                        className="size-4 accent-[var(--accent-hover)]"
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        "h-11 px-3 text-sm whitespace-nowrap first:pl-5 last:pr-5",
                        column.align === "right" && "text-right tabular-nums",
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {mobileCard && (
        <ul className="m-0 list-none p-0 sm:hidden">
          {sorted.map((row) => (
            <li key={rowKey(row)} className="border-t border-border first:border-t-0">
              {mobileCard(row)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
