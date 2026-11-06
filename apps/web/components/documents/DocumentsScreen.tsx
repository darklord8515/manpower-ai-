"use client";

import {
  CalendarClock,
  CircleAlert,
  Copy,
  Download,
  FileX,
  Phone,
  Search,
  TriangleAlert,
  UserCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SlidingTabs } from "@/components/motion/SlidingTabs";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusChip } from "@/components/ui/StatusChip";
import { BUTTON } from "@/components/ui/button-styles";
import { WorkerSheet } from "@/components/workers/WorkerSheet";
import { api, type ExpiryWindow } from "@/lib/api";
import type { ExpiringDocument } from "@/lib/api-types";
import { DOCUMENT_NAME, timeLeft } from "@/lib/documents";
import {
  DEFAULT_DOCUMENTS_QUERY,
  fromDocumentsSearch,
  toDocumentsSearch,
  type DocumentsQuery,
} from "@/lib/documents-query";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

const SELECT =
  "h-9 min-w-0 rounded-control border border-border-strong bg-surface px-3 text-sm transition-colors hover:bg-hover disabled:opacity-60";

const EMPTY: Record<ExpiryWindow, { title: string; body: string }> = {
  expired: { title: "Nothing has expired", body: "Every document on file is still valid." },
  d30: { title: "Nothing runs out in 30 days", body: "No document needs action this month." },
  d60: { title: "Nothing runs out in 31 to 60 days", body: "No document falls in this period." },
  d90: { title: "Nothing runs out in 61 to 90 days", body: "No document falls in this period." },
};

function readAddress() {
  if (typeof window === "undefined") return { query: DEFAULT_DOCUMENTS_QUERY, open: null };
  return fromDocumentsSearch(window.location.search);
}

const rowKey = (d: ExpiringDocument) => `${d.worker_code}:${d.type}`;

function LeftChip({ days }: { days: number }) {
  const { tone, label } = timeLeft(days);
  return (
    <StatusChip tone={tone} icon={tone === "danger" ? CircleAlert : CalendarClock} label={label} />
  );
}

/** The job's last day, and a warning when the document runs out before it. */
function JobEnds({ d }: { d: ExpiringDocument }) {
  if (!d.project) return <span className="text-subtle">Not on a project</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-muted">{d.job_ends ? formatDate(d.job_ends) : "No end date"}</span>
      {d.ends_before_job && (
        <StatusChip tone="warning" icon={TriangleAlert} label="ends before the job" />
      )}
    </span>
  );
}

/** Documents by when they run out: the daily list HR works through. */
export function DocumentsScreen() {
  const [initial] = useState(readAddress); // read once, from the address bar
  const [query, setQuery] = useState<DocumentsQuery>(initial.query);
  const [search, setSearch] = useState(initial.query.q);
  const [open, setOpen] = useState<string | null>(initial.open);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);

  const filters = { q: query.q, type: query.type, project: query.project };
  const docs = useLoad(
    () => api.expiring(query.window, filters),
    `${query.window}|${query.q}|${query.type}|${query.project}`,
  );
  const facets = useLoad(() => api.workerFacets(), "facets");

  const change = useCallback((changes: Partial<DocumentsQuery>) => {
    setQuery((q) => ({ ...q, ...changes }));
    setSelected(new Set());
    setNotice("");
  }, []);

  // The search box waits for a pause in typing before asking the API.
  useEffect(() => {
    if (search === query.q) return;
    const timer = window.setTimeout(() => change({ q: search }), 250);
    return () => window.clearTimeout(timer);
  }, [search, query.q, change]);

  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${toDocumentsSearch(query, open)}`,
    );
  }, [query, open]);

  // "/" jumps to the search box.
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

  const counts = docs.data?.counts;
  const rows = docs.data?.items ?? [];
  const filtered = query.q !== "" || query.type !== "" || query.project !== "";
  const openName = rows.find((r) => r.worker_code === open)?.worker_name;
  const projects = facets.data?.projects ?? [];

  async function copyPhones() {
    const phones = rows
      .filter((r) => selected.has(rowKey(r)) && r.phone)
      .map((r) => r.phone as string);
    const unique = [...new Set(phones)];
    try {
      await navigator.clipboard.writeText(unique.join("\n"));
      setNotice(`Copied ${unique.length} phone ${unique.length === 1 ? "number" : "numbers"}.`);
    } catch {
      setNotice("Couldn’t copy. Select the numbers and copy them by hand.");
    }
  }

  const columns: Column<ExpiringDocument>[] = [
    {
      key: "worker",
      header: "Worker",
      cell: (d) => (
        <button
          type="button"
          onClick={() => setOpen(d.worker_code)}
          className="rounded-control text-left font-medium hover:underline"
        >
          {d.worker_name}{" "}
          <span className="font-mono text-xs font-normal text-subtle">{d.worker_code}</span>
        </button>
      ),
    },
    { key: "type", header: "Document", cell: (d) => DOCUMENT_NAME[d.type] ?? d.type },
    { key: "expiry", header: "Expires", cell: (d) => formatDate(d.expiry) },
    { key: "left", header: "Time left", cell: (d) => <LeftChip days={d.days_left} /> },
    {
      key: "project",
      header: "Project",
      cell: (d) =>
        d.project ? (
          <span className="font-mono text-xs">{d.project}</span>
        ) : (
          <span className="text-subtle">None</span>
        ),
    },
    { key: "job", header: "Job ends", cell: (d) => <JobEnds d={d} /> },
    {
      key: "phone",
      header: "Phone",
      cell: (d) =>
        d.phone ? (
          <a
            href={`tel:${d.phone.replace(/\s+/g, "")}`}
            className="inline-flex items-center gap-1.5 text-accent-text hover:underline"
          >
            <Phone className="size-3.5" aria-hidden="true" />
            {d.phone}
          </a>
        ) : (
          <span className="text-subtle">—</span>
        ),
    },
  ];

  const tab = (id: ExpiryWindow, label: string) => ({
    id,
    label,
    count: counts ? counts[id] : undefined,
  });

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Documents</h1>
          <p className="text-sm text-muted" aria-live="polite">
            {counts
              ? `${counts.expired} expired, ${counts.d30} running out in 30 days`
              : "Loading documents"}
          </p>
        </div>
        <a
          href={api.documentsCsvUrl(query.window, filters)}
          download={`documents-${query.window}.csv`}
          className={BUTTON}
        >
          <Download className="size-4" aria-hidden="true" />
          Download CSV
        </a>
      </header>

      <section aria-label="Documents" className="rounded-card border border-border bg-surface">
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
                placeholder="Search name or code"
                className="h-9 w-full rounded-control border border-border-strong bg-surface pr-8 pl-9 text-sm placeholder:text-subtle"
              />
              <kbd
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded border border-border px-1 text-xs text-subtle md:block"
              >
                /
              </kbd>
            </label>
            <select
              aria-label="Document"
              className={SELECT}
              value={query.type}
              onChange={(e) => change({ type: e.target.value })}
            >
              <option value="">All documents</option>
              {Object.entries(DOCUMENT_NAME).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Project"
              className={SELECT}
              value={query.project}
              disabled={!facets.data}
              onChange={(e) => change({ project: e.target.value })}
            >
              <option value="">All projects</option>
              {projects.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.value}
                </option>
              ))}
            </select>
            {filtered && (
              <button
                type="button"
                className={BUTTON}
                onClick={() => {
                  setSearch("");
                  change({ q: "", type: "", project: "" });
                }}
              >
                <X className="size-4" aria-hidden="true" />
                Clear filters
              </button>
            )}
          </div>
          <SlidingTabs
            label="When it expires"
            value={query.window}
            onChange={(id) => change({ window: id as ExpiryWindow })}
            tabs={[
              tab("expired", "Expired"),
              tab("d30", "Next 30 days"),
              tab("d60", "31–60 days"),
              tab("d90", "61–90 days"),
            ]}
          />
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

        <div
          aria-busy={docs.refreshing}
          className={docs.refreshing ? "opacity-60 transition-opacity" : ""}
        >
          <DataTable
            caption="Documents"
            columns={columns}
            rows={rows}
            rowKey={rowKey}
            loading={docs.loading}
            error={docs.error ? { message: docs.error, onRetry: docs.retry } : undefined}
            selectable
            selected={selected}
            onSelectedChange={setSelected}
            empty={
              filtered ? (
                <EmptyState
                  icon={FileX}
                  title="No documents match"
                  action={
                    <button
                      type="button"
                      className={BUTTON}
                      onClick={() => {
                        setSearch("");
                        change({ q: "", type: "", project: "" });
                      }}
                    >
                      Clear filters
                    </button>
                  }
                >
                  Try another tab, or remove a filter.
                </EmptyState>
              ) : (
                <EmptyState icon={UserCheck} title={EMPTY[query.window].title}>
                  {EMPTY[query.window].body}
                </EmptyState>
              )
            }
            mobileCard={(d) => (
              <button
                type="button"
                onClick={() => setOpen(d.worker_code)}
                className="flex w-full flex-col gap-1.5 px-4 py-3 text-left text-sm"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{d.worker_name}</span>
                  <LeftChip days={d.days_left} />
                </span>
                <span className="text-xs text-muted">
                  {DOCUMENT_NAME[d.type] ?? d.type} · {formatDate(d.expiry)} ·{" "}
                  {d.project ?? "No project"}
                </span>
                {d.ends_before_job && (
                  <StatusChip tone="warning" icon={TriangleAlert} label="ends before the job" />
                )}
              </button>
            )}
          />
        </div>
      </section>

      <WorkerSheet
        code={open}
        fallbackName={openName}
        initialTab="documents"
        onClose={() => setOpen(null)}
      />
    </div>
  );
}
