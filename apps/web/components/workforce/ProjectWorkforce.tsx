"use client";

import { ArrowLeft, CalendarDays, Pencil, Search, Users } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip } from "@/components/ui/StatusChip";
import { api } from "@/lib/api";
import type { WLine, WPeople, WPlan } from "@/lib/api-types";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { PersonSheet } from "./PersonSheet";
import { dateLine } from "./ProjectsList";
import { Legend, messageOf, PeopleTable, STAGE_TONE } from "./shared";

const STAGES: [string, string][] = [
  ["pre_construction", "Pre-construction"],
  ["active", "Under construction"],
  ["handover", "Handover"],
  ["completed", "Completed"],
  ["on_hold", "On hold"],
];

function Tile({ label, value, tone }: { label: string; value: number; tone?: "bad" }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="m-0 text-xs text-muted">{label}</p>
      <p
        className={cn(
          "m-0 text-2xl font-semibold tabular-nums",
          tone === "bad" && value > 0 && "text-danger-text",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** What the project plans for each role, against who has joined and who is on the way. */
function PlanTable({
  title,
  lines,
  code,
  canEdit,
  onSaved,
}: {
  title: string;
  lines: WLine[];
  code: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  if (lines.length === 0) return null;

  async function save(line: WLine) {
    setProblem(null);
    try {
      await api.wSetPlan(code, { designation: line.role, uae_only: line.uae_only, planned: value });
      setEditing(null);
      onSaved();
    } catch (e) {
      setProblem(messageOf(e));
    }
  }

  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h3 className="m-0 text-sm font-semibold">{title}</h3>
      {problem && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {problem}
        </p>
      )}
      <div className="overflow-x-auto rounded-control border border-border">
        <table className="w-full min-w-max border-collapse text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="bg-sunken text-left text-xs text-muted">
              {[
                "Designation",
                "Planned",
                "Joined",
                "On the way",
                "To hire",
                "Over",
                ...(canEdit ? [""] : []),
              ].map((h) => (
                <th key={h || "edit"} scope="col" className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const key = l.designation;
              return (
                <tr key={key} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{l.designation}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {editing === key ? (
                      <input
                        type="number"
                        min={0}
                        className={cn(FIELD, "w-20")}
                        aria-label={`Planned ${l.designation}`}
                        value={value}
                        onChange={(e) => setValue(Number(e.target.value))}
                      />
                    ) : (
                      l.planned
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{l.active}</td>
                  <td className="px-3 py-2 tabular-nums">{l.pipeline}</td>
                  <td className="px-3 py-2 font-semibold tabular-nums">{l.to_hire}</td>
                  <td
                    className={cn(
                      "px-3 py-2 tabular-nums",
                      l.over > 0 && "font-semibold text-danger-text",
                    )}
                  >
                    {l.over || "—"}
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2 text-right">
                      {editing === key ? (
                        <span className="inline-flex gap-1">
                          <button
                            type="button"
                            className={PRIMARY_BUTTON}
                            onClick={() => void save(l)}
                          >
                            Save
                          </button>
                          <button type="button" className={BUTTON} onClick={() => setEditing(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={BUTTON}
                          aria-label={`Edit planned ${l.designation}`}
                          onClick={() => {
                            setEditing(key);
                            setValue(l.planned);
                          }}
                        >
                          <Pencil className="size-3.5" aria-hidden="true" />
                          Edit
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One of the two people tables (staff, then labour), with a designation filter and search. */
function PeopleBlock({
  title,
  data,
  onOpen,
}: {
  title: string;
  data: WPeople;
  onOpen: (code: string) => void;
}) {
  const [designation, setDesignation] = useState("");
  const [q, setQ] = useState("");
  const kinds = useMemo(() => {
    const found = new Map<string, number>();
    for (const p of data.items) found.set(p.designation, (found.get(p.designation) ?? 0) + 1);
    return [...found.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [data.items]);
  const shown = data.items.filter(
    (p) =>
      (!designation || p.designation === designation) &&
      (!q.trim() || `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-md font-semibold">
          {title} <span className="text-sm font-normal text-muted">({data.total})</span>
        </h2>
        {data.items.length > 0 && (
          <label className="relative block">
            <span className="sr-only">Search {title}</span>
            <Search
              className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-subtle"
              aria-hidden="true"
            />
            <input
              className={cn(FIELD, "pl-8")}
              value={q}
              placeholder="Search"
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
        )}
      </header>
      {data.items.length === 0 ? (
        <EmptyState icon={Users} title={`No ${title.toLowerCase()} yet`} className="py-6">
          People appear here when they are added or placed on this project.
        </EmptyState>
      ) : (
        <>
          <div
            role="group"
            aria-label={`Filter ${title} by designation`}
            className="flex gap-2 overflow-x-auto pb-1"
          >
            {[
              ["", "All", data.items.length] as const,
              ...kinds.map(([n, c]) => [n, n, c] as const),
            ].map(([value, label, n]) => (
              <button
                key={value || "all"}
                type="button"
                aria-pressed={designation === value}
                onClick={() => setDesignation(value)}
                className={cn(
                  "press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border-strong px-3 text-xs font-medium transition-colors",
                  designation === value ? "bg-hover text-fg" : "bg-surface text-muted",
                )}
              >
                {label}
                <span className="tabular-nums text-subtle">{n}</span>
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <p className="m-0 text-sm text-muted">No one matches.</p>
          ) : (
            <PeopleTable
              items={shown}
              showProject={false}
              onOpen={onOpen}
              caption={`${title} on this project`}
            />
          )}
        </>
      )}
    </section>
  );
}

function EditProject({
  plan,
  open,
  onClose,
  onSaved,
}: {
  plan: WPlan;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [stage, setStage] = useState(
    plan.project.stage === "planning" ? "pre_construction" : plan.project.stage,
  );
  const [starts, setStarts] = useState(plan.project.starts_on ?? "");
  const [ends, setEnds] = useState(plan.project.ends_on ?? "");
  const [real, setReal] = useState(plan.project.actual_end_on ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setProblem(null);
    try {
      await api.wPatchProject(plan.project.code, {
        stage,
        starts_on: starts || null,
        ends_on: ends || null,
        actual_end_on: real || null,
      });
      onSaved();
      onClose();
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <DetailSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Edit project"
      meta={plan.project.name}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Stage
          <select className={FIELD} value={stage} onChange={(e) => setStage(e.target.value)}>
            {STAGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Start date
            <input
              type="date"
              className={FIELD}
              value={starts}
              onChange={(e) => setStarts(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Expected end date
            <input
              type="date"
              className={FIELD}
              value={ends}
              onChange={(e) => setEnds(e.target.value)}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Real end date (when it actually finished)
          <input
            type="date"
            className={FIELD}
            value={real}
            onChange={(e) => {
              setReal(e.target.value);
              if (e.target.value) setStage("completed"); // a project that has ended is completed
            }}
          />
          <span className="font-normal">
            Leave empty while the project is running. Setting it marks the project as completed.
          </span>
        </label>
        {problem && (
          <p
            role="alert"
            className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
          >
            {problem}
          </p>
        )}
        <div className="flex gap-2">
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button type="button" className={BUTTON} onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </DetailSheet>
  );
}

/** One project: what it plans, then its staff in one table and its labour in another below it. */
export function ProjectWorkforce({ code }: { code: string }) {
  const permissions = useUser().permissions;
  const canPlan = permissions.includes("project:write");
  const plan = useLoad(() => api.wProjectPlan(code), `w-plan:${code}`);
  const people = useLoad(() => api.wProjectPeople(code), `w-project-people:${code}`);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const reload = () => {
    plan.retry();
    people.retry();
  };

  if (plan.loading && !plan.data)
    return <SkeletonLoader label="Loading the project" variant="rows" count={6} />;
  if (plan.error || !plan.data)
    return (
      <ErrorState title="Couldn’t load the project" onRetry={plan.retry}>
        {plan.error}
      </ErrorState>
    );
  const p = plan.data;
  const all = ["planned", "active", "pipeline", "to_hire", "over"].reduce(
    (acc, k) => ({
      ...acc,
      [k]:
        p.totals.staff[k as keyof typeof p.totals.staff] +
        p.totals.labour[k as keyof typeof p.totals.labour],
    }),
    {} as Record<string, number>,
  );

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/projects"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Projects
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{p.project.name}</h1>
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <StatusChip
              tone={STAGE_TONE[p.project.stage] ?? "neutral"}
              icon={CalendarDays}
              label={STAGES.find(([v]) => v === p.project.stage)?.[1] ?? p.project.stage}
            />
            <span>{dateLine(p.project)}</span>
          </p>
        </div>
        {canPlan && (
          <button type="button" className={BUTTON} onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit stage and dates
          </button>
        )}
      </header>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Planned" value={all.planned} />
        <Tile label="Joined" value={all.active} />
        <Tile label="On the way" value={all.pipeline} />
        <Tile label="Still to hire" value={all.to_hire} />
      </section>
      {all.over > 0 && (
        <p
          role="status"
          className="m-0 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-text"
        >
          {all.over} more {all.over === 1 ? "person is" : "people are"} placed than planned. Raise
          the plan or move someone.
        </p>
      )}
      <Legend />

      <section
        aria-label="Plan by designation"
        className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4"
      >
        <h2 className="m-0 text-md font-semibold">Plan by designation</h2>
        <PlanTable title="Staff" lines={p.staff} code={code} canEdit={canPlan} onSaved={reload} />
        <PlanTable title="Labour" lines={p.labour} code={code} canEdit={canPlan} onSaved={reload} />
        {p.staff.length === 0 && p.labour.length === 0 && (
          <p className="m-0 text-sm text-muted">This project has no planned places yet.</p>
        )}
      </section>

      {people.loading && !people.data ? (
        <SkeletonLoader label="Loading the people" variant="rows" count={4} />
      ) : people.error || !people.data ? (
        <ErrorState title="Couldn’t load the people" onRetry={people.retry}>
          {people.error}
        </ErrorState>
      ) : (
        <>
          <PeopleBlock title="Staff" data={people.data.staff} onOpen={setOpen} />
          <PeopleBlock title="Labour" data={people.data.labour} onOpen={setOpen} />
        </>
      )}

      <PersonSheet code={open} onClose={() => setOpen(null)} onChanged={reload} />
      <EditProject
        key={String(editing)}
        plan={p}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={reload}
      />
    </div>
  );
}
