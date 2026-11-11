"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { Legend, StackBar } from "./shared";

function Tile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="m-0 text-xs text-muted">{label}</p>
      <p className="m-0 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="m-0 text-xs text-muted">{hint}</p>
    </div>
  );
}

/** Home for HR and the MD: planned against ongoing per project, what to hire, what the AI did. */
export function WorkforceHome() {
  const chart = useLoad(() => api.wChart(), "w-chart");
  const board = useLoad(() => api.wBoard(), "w-board:");
  const ai = useLoad(() => api.wHistory("ai"), "w-history:ai:");

  if (chart.loading && !chart.data)
    return <SkeletonLoader label="Loading Home" variant="rows" count={6} />;
  if (chart.error || !chart.data)
    return (
      <ErrorState title="Couldn’t load Home" onRetry={chart.retry}>
        {chart.error}
      </ErrorState>
    );
  const { projects, totals } = chart.data;
  const scale = Math.max(1, ...projects.map((p) => Math.max(p.planned, p.active + p.pipeline)));
  const construction = projects.filter((p) => p.kind === "project");
  const others = projects.filter((p) => p.kind !== "project");

  const bars = (rows: typeof projects) => (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map((p) => (
        <li key={p.code}>
          <Link
            href={`/projects/${p.code}`}
            className="flex flex-col gap-1 rounded-control p-1 hover:bg-hover"
          >
            <span className="flex flex-wrap justify-between gap-x-3 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted tabular-nums">
                {p.active} joined · {p.pipeline} on the way · {p.to_hire} to hire · planned{" "}
                {p.planned}
              </span>
            </span>
            <StackBar counts={p} scale={scale} />
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Planned" value={totals.planned} hint="Places across all projects" />
        <Tile label="Joined" value={totals.active} hint="Working now" />
        <Tile label="On the way" value={totals.pipeline} hint="Offer issued or documents cleared" />
        <Tile label="Still to hire" value={totals.to_hire} hint="Open places" />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section
          aria-label="Planned and ongoing by project"
          className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 lg:col-span-2"
        >
          <header className="flex flex-col gap-1">
            <h2 className="m-0 text-md font-semibold">Planned and ongoing, by project</h2>
            <Legend />
          </header>
          {construction.length === 0 ? (
            <p className="m-0 text-sm text-muted">No projects yet.</p>
          ) : (
            bars(construction)
          )}
          {others.length > 0 && (
            <>
              <h3 className="m-0 text-sm font-semibold">Head office and other groups</h3>
              {bars(others)}
            </>
          )}
        </section>

        <div className="flex flex-col gap-4">
          <section
            aria-label="Needs hiring"
            className="rounded-card border border-border bg-surface p-4"
          >
            <h2 className="m-0 mb-3 text-md font-semibold">Needs hiring</h2>
            {board.loading && !board.data ? (
              <SkeletonLoader label="Loading recruitment" variant="lines" count={4} />
            ) : board.error ? (
              <ErrorState title="Couldn’t load" onRetry={board.retry}>
                {board.error}
              </ErrorState>
            ) : !board.data || board.data.rows.length === 0 ? (
              <p className="m-0 text-sm text-muted">Every planned place is filled.</p>
            ) : (
              <>
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {board.data.rows.slice(0, 6).map((r) => (
                    <li
                      key={r.kind + r.designation}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <span>{r.designation}</span>
                      <span className="font-semibold tabular-nums">{r.to_hire}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/recruitment"
                  className="mt-3 inline-block text-sm text-accent-text hover:underline"
                >
                  See all {board.data.rows.length} roles
                </Link>
              </>
            )}
          </section>

          <section
            aria-label="Recent AI actions"
            className="rounded-card border border-border bg-surface p-4"
          >
            <h2 className="m-0 mb-3 flex items-center gap-2 text-md font-semibold">
              <Bot className="size-4" aria-hidden="true" />
              What the AI did
            </h2>
            {ai.loading && !ai.data ? (
              <SkeletonLoader label="Loading history" variant="lines" count={3} />
            ) : !ai.data || ai.data.length === 0 ? (
              <p className="m-0 text-sm text-muted">
                Nothing yet. When the AI places someone, it shows here with its reason.
              </p>
            ) : (
              <>
                <ul className="m-0 flex list-none flex-col gap-3 p-0">
                  {ai.data.slice(0, 4).map((h) => (
                    <li key={h.at + (h.person_code ?? "")} className="text-sm">
                      <span className="font-medium">{h.person_name}</span>
                      {h.to_project ? ` → ${h.to_project}` : ""}
                      <span className="block text-xs text-muted">
                        {formatDate(h.at.slice(0, 10))}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/history"
                  className="mt-3 inline-block text-sm text-accent-text hover:underline"
                >
                  Open the history
                </Link>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
