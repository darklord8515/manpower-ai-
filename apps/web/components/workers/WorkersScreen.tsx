"use client";

import {
  CalendarClock,
  CircleAlert,
  Copy,
  Download,
  Search,
  SearchX,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SlidingTabs } from "@/components/motion/SlidingTabs";
import { DataTable, type Column, type Sort } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusChip } from "@/components/ui/StatusChip";
import { api } from "@/lib/api";
import type { WorkerRow, WorkerStatus } from "@/lib/api-types";
import { DOCUMENT_NAME, timeLeft } from "@/lib/documents";
import { formatInt } from "@/lib/format";
import { useAddress } from "@/lib/use-address";
import {
  DEFAULT_QUERY,
  PAGE_SIZE,
  fromSearch,
  toSearch,
  type WorkersQuery,
} from "@/lib/workers-query";
import { useWorkerFacets, useWorkerList } from "./useWorkers";
import { WorkerSheet } from "./WorkerSheet";
import { STATUS_LABEL, WorkerStatusChip } from "./WorkerStatusChip";

const SELECT =
  "h-9 min-w-0 rounded-control border border-border-strong bg-surface px-3 text-sm transition-colors hover:bg-hover disabled:opacity-60";
const BUTTON =
  "press inline-flex h-9 items-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-sm font-medium transition-[transform,background-color] duration-120 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60";

const STATUS_ORDER: WorkerStatus[] = ["available", "deployed", "mobilizing", "unavailable"];

function DocumentChip({ doc }: { doc: WorkerRow["next_document"] }) {
  if (!doc) return <span className="text-subtle">None</span>;
  const { tone, label } = timeLeft(doc.days_left);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-muted">{DOCUMENT_NAME[doc.type] ?? doc.type}</span>
      <StatusChip
        tone={tone}
        icon={tone === "danger" ? CircleAlert : CalendarClock}
        label={label}
      />
    </span>
  );
}

export function WorkersScreen() {
  const address = useAddress();
  const [initial] = useState(() => fromSearch(address)); // read once, from the address bar
  const [query, setQuery] = useState<WorkersQuery>(initial.query);
  const [open, setOpen] = useState<string | null>(initial.open);
  const [search, setSearch] = useState(initial.query.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);

  const { list, error, loading, refreshing, retry } = useWorkerList(query);
  const { facets, error: facetError, retry: retryFacets } = useWorkerFacets();

  // A changed filter or sort starts again from page 1 and forgets the ticked rows.
  const change = useCallback((changes: Partial<WorkersQuery>) => {
    setQuery((q) => ({ ...q, page: 1, ...changes }));
    setSelected(new Set());
    setNotice("");
  }, []);

  // The search box waits for a pause in typing before asking the API.
  useEffect(() => {
    if (search === query.q) return;
    const timer = window.setTimeout(() => change({ q: search }), 250);
    return () => window.clearTimeout(timer);
  }, [search, query.q, change]);

  // The address bar always shows the current view, so it can be shared or reloaded.
  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${toSearch(query, open)}`,
    );
  }, [query, open]);

  // "/" jumps to the search box, as in most work tools.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target && (/^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName) || target.isContentEditable);
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        searchBox.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filtered =
    query.q !== "" ||
    query.trade !== "" ||
    query.project !== "" ||
    query.status !== "" ||
    query.documents !== "";
  const total = list?.total ?? 0;
  const rows = list?.items ?? [];
  const narrow = list !== null && rows.length > 0 && rows[0].status === null;
  const from = total === 0 ? 0 : (query.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(query.page * PAGE_SIZE, total);
  const everyone = facets ? facets.statuses.reduce((sum, f) => sum + f.count, 0) : undefined;
  const countOf = (value: string) => facets?.statuses.find((f) => f.value === value)?.count;
  const openName = rows.find((r) => r.code === open)?.name;

  function clearFilters() {
    setSearch("");
    change({ ...DEFAULT_QUERY });
  }

  async function copyPhones() {
    const phones = rows.filter((r) => selected.has(r.code) && r.phone).map((r) => r.phone);
    try {
      await navigator.clipboard.writeText(phones.join("\n"));
      setNotice(`Copied ${phones.length} phone ${phones.length === 1 ? "number" : "numbers"}.`);
    } catch {
      setNotice("Couldn’t copy. Select the numbers and copy them by hand.");
    }
  }

  const columns: Column<WorkerRow>[] = [
    {
      key: "name",
      header: "Worker",
      sortValue: () => 0,
      cell: (w) => (
        <button
          type="button"
          onClick={() => setOpen(w.code)}
          className="rounded-control text-left font-medium hover:underline"
        >
          {w.name} <span className="font-mono text-xs font-normal text-subtle">{w.code}</span>
        </button>
      ),
    },
    { key: "trade", header: "Trade", sortValue: () => 0, cell: (w) => w.trade },
    ...(narrow
      ? [{ key: "phone", header: "Phone", cell: (w: WorkerRow) => w.phone ?? "" }]
      : [
          {
            key: "level",
            header: "Level",
            align: "right" as const,
            sortValue: () => 0,
            cell: (w: WorkerRow) => w.level ?? "—",
          },
          {
            key: "status",
            header: "Status",
            cell: (w: WorkerRow) => (w.status ? <WorkerStatusChip status={w.status} /> : null),
          },
          {
            key: "project",
            header: "Project",
            sortValue: () => 0,
            cell: (w: WorkerRow) =>
              w.project ? (
                <span className="font-mono text-xs">{w.project}</span>
              ) : (
                <span className="text-subtle">None</span>
              ),
          },
          {
            key: "docs",
            header: "Next document",
            sortValue: () => 0,
            cell: (w: WorkerRow) => <DocumentChip doc={w.next_document} />,
          },
        ]),
  ];

  const sort: Sort = { key: query.sort, dir: query.dir };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Workers</h1>
          <p className="text-sm text-muted" aria-live="polite">
            {list
              ? filtered
                ? `${formatInt(total)} ${total === 1 ? "person matches" : "people match"}`
                : `${formatInt(total)} people`
              : "Loading the directory"}
          </p>
        </div>
        {!narrow && (
          <a href={api.workersCsvUrl(query)} download="workers.csv" className={BUTTON}>
            <Download className="size-4" aria-hidden="true" />
            Download CSV
          </a>
        )}
      </header>

      <section
        aria-label="Worker directory"
        className="rounded-card border border-border bg-surface"
      >
        <div className="flex flex-col gap-3 border-b border-border p-3 md:p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-52 flex-1 md:max-w-sm">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
                aria-hidden="true"
              />
              <input
                ref={searchBox}
                type="search"
                aria-label="Search workers"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
                placeholder="Search name, code or trade"
                className="h-9 w-full rounded-control border border-border-strong bg-surface pr-8 pl-9 text-sm placeholder:text-subtle"
              />
              <kbd
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-border px-1 text-xs text-subtle md:block"
              >
                /
              </kbd>
            </label>
            {!narrow && (
              <>
                <select
                  aria-label="Trade"
                  className={SELECT}
                  value={query.trade}
                  disabled={!facets}
                  onChange={(e) => change({ trade: e.target.value })}
                >
                  <option value="">All trades</option>
                  {facets?.trades.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.value} ({f.count})
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Project"
                  className={SELECT}
                  value={query.project}
                  disabled={!facets}
                  onChange={(e) => change({ project: e.target.value })}
                >
                  <option value="">All projects</option>
                  {facets?.projects.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.value} ({f.count})
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Documents"
                  className={SELECT}
                  value={query.documents}
                  disabled={!facets}
                  onChange={(e) =>
                    change({ documents: e.target.value as WorkersQuery["documents"] })
                  }
                >
                  <option value="">All documents</option>
                  <option value="expired">
                    Expired{facets ? ` (${facets.documents.expired})` : ""}
                  </option>
                  <option value="30">
                    Running out in 30 days{facets ? ` (${facets.documents.expiring_30})` : ""}
                  </option>
                </select>
              </>
            )}
            {filtered && (
              <button type="button" onClick={clearFilters} className={BUTTON}>
                <X className="size-4" aria-hidden="true" />
                Clear filters
              </button>
            )}
          </div>
          {!narrow && (
            <SlidingTabs
              label="Status"
              value={query.status}
              onChange={(id) => change({ status: id as WorkersQuery["status"] })}
              tabs={[
                { id: "", label: "Everyone", count: everyone },
                ...STATUS_ORDER.map((s) => ({
                  id: s as string,
                  label: STATUS_LABEL[s],
                  count: countOf(s),
                })),
              ]}
            />
          )}
          {facetError && (
            <p role="alert" className="m-0 text-xs text-muted">
              The filter counts couldn’t load.{" "}
              <button type="button" onClick={retryFacets} className="text-accent-text underline">
                Try again
              </button>
            </p>
          )}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-control bg-accent-soft px-3 py-2 text-sm">
              <span className="font-medium">{selected.size} selected</span>
              <button type="button" onClick={copyPhones} className={BUTTON}>
                <Copy className="size-4" aria-hidden="true" />
                Copy phone numbers
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(new Set());
                  setNotice("");
                }}
                className={BUTTON}
              >
                Clear selection
              </button>
            </div>
          )}
          <p role="status" className="m-0 text-xs text-muted empty:hidden">
            {notice}
          </p>
        </div>

        <div aria-busy={refreshing} className={refreshing ? "opacity-60 transition-opacity" : ""}>
          <DataTable
            caption="Workers"
            columns={columns}
            rows={rows}
            rowKey={(w) => w.code}
            loading={loading}
            error={error ? { message: error, onRetry: retry } : undefined}
            selectable={!narrow}
            selected={selected}
            onSelectedChange={setSelected}
            sort={sort}
            onSortChange={(next) =>
              change(
                next
                  ? { sort: next.key as WorkersQuery["sort"], dir: next.dir }
                  : { sort: DEFAULT_QUERY.sort, dir: DEFAULT_QUERY.dir },
              )
            }
            empty={
              filtered ? (
                <EmptyState
                  icon={SearchX}
                  title="No one matches"
                  action={
                    <button type="button" onClick={clearFilters} className={BUTTON}>
                      Clear filters
                    </button>
                  }
                >
                  Try a different name, or remove a filter.
                </EmptyState>
              ) : (
                <EmptyState icon={Users} title="No workers yet">
                  People appear here once they are added.
                </EmptyState>
              )
            }
            mobileCard={(w) => (
              <button
                type="button"
                onClick={() => setOpen(w.code)}
                className="flex w-full flex-col gap-1.5 px-4 py-3 text-left text-sm"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {w.name}{" "}
                    <span className="font-mono text-xs font-normal text-subtle">{w.code}</span>
                  </span>
                  {w.status && <WorkerStatusChip status={w.status} />}
                </span>
                <span className="text-xs text-muted">
                  {[w.trade, w.level ? `Level ${w.level}` : null, w.project]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {w.next_document && <DocumentChip doc={w.next_document} />}
              </button>
            )}
          />
        </div>

        {list && total > 0 && (
          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
            <span className="text-muted">
              Showing {formatInt(from)}–{formatInt(to)} of {formatInt(total)}
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                className={BUTTON}
                disabled={query.page <= 1}
                onClick={() => change({ page: query.page - 1 })}
              >
                Previous
              </button>
              <button
                type="button"
                className={BUTTON}
                disabled={to >= total}
                onClick={() => change({ page: query.page + 1 })}
              >
                Next
              </button>
            </span>
          </footer>
        )}
      </section>

      <WorkerSheet code={open} fallbackName={openName} onClose={() => setOpen(null)} />
    </div>
  );
}
