import type { ReactNode } from "react";

export type KanbanColumn<T> = {
  id: string;
  title: string;
  /** One line under the title: what belongs in this column. */
  hint: string;
  items: T[];
  /** Said when the column has nothing in it. */
  empty: string;
};

type Props<T> = {
  label: string;
  columns: KanbanColumn<T>[];
  keyOf: (item: T) => string;
  renderCard: (item: T) => ReactNode;
};

/**
 * A pipeline of columns with a card per item. Four columns side by side from 1024px, stacked
 * sections below. Cards are not draggable: where a card sits is decided by the data (the Python
 * service), never by hand.
 */
export function KanbanBoard<T>({ label, columns, keyOf, renderCard }: Props<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid items-start gap-4 lg:grid-cols-[repeat(var(--columns),minmax(0,1fr))]"
      style={{ "--columns": columns.length } as React.CSSProperties}
    >
      {columns.map((column) => (
        <section
          key={column.id}
          aria-label={column.title}
          data-column={column.id}
          className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-sunken p-3"
        >
          <header className="flex flex-col gap-0.5">
            <h2 className="m-0 flex items-center justify-between gap-2 text-sm font-semibold">
              {column.title}
              <span
                aria-label={`${column.items.length} ${column.items.length === 1 ? "person" : "people"}`}
                className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted tabular-nums"
              >
                {column.items.length}
              </span>
            </h2>
            <p className="m-0 text-xs text-muted">{column.hint}</p>
          </header>
          {column.items.length === 0 ? (
            <p className="m-0 rounded-control border border-dashed border-border-strong px-3 py-4 text-center text-xs text-muted">
              {column.empty}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {column.items.map((item) => (
                <li key={keyOf(item)}>{renderCard(item)}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
