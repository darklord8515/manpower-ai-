"use client";

import { CircleCheck, Search, SearchX } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { SlidingTabs } from "@/components/motion/SlidingTabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { TYPE_LABEL, gulfDay, lastRunText } from "@/lib/alerts";
import { api, ApiError } from "@/lib/api";
import type { AlertRow, AlertSeverity, AlertType } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useAddress } from "@/lib/use-address";
import { useLoad } from "@/lib/use-load";
import { AlertItems } from "./AlertItems";
import { AlertSheet } from "./AlertSheet";
import { SnoozePanel } from "./SnoozePanel";

type View = "open" | "snoozed" | "cleared";
const SEVERITIES: AlertSeverity[] = ["critical", "action_needed", "info"];

function readAddress(search: string): { alert: string | null; severity: AlertSeverity | "" } {
  const params = new URLSearchParams(search);
  const severity = params.get("severity");
  return {
    alert: params.get("alert"),
    severity: SEVERITIES.includes(severity as AlertSeverity) ? (severity as AlertSeverity) : "",
  };
}

function worst(items: AlertRow[]): AlertSeverity {
  if (items.some((a) => a.severity === "critical")) return "critical";
  if (items.some((a) => a.severity === "action_needed")) return "action_needed";
  return "info";
}

/** Everything that needs HR, most urgent first. The MD/CEO sees the same list and cannot act on it. */
export function TodoScreen() {
  const user = useUser();
  const address = useAddress();
  const [initial] = useState(() => readAddress(address)); // read once, from the address bar
  const [view, setView] = useState<View>("open");
  const [severity, setSeverity] = useState<AlertSeverity | "">(initial.severity);
  const [type, setType] = useState<AlertType | "">("");
  const [project, setProject] = useState("");
  const [mine, setMine] = useState(false);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(initial.alert);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"snooze" | "assign" | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [version, setVersion] = useState(0); // goes up after every change made on the server

  const list = useLoad(
    () => api.alerts({ view, severity, type, project, mine, q }),
    `${view}|${severity}|${type}|${project}|${mine}|${q}|${version}`,
  );
  const projects = useLoad(
    () => api.projects(),
    "projects",
    user.permissions.includes("project:read"),
  );
  const canAct = list.data?.can_act ?? user.permissions.includes("alert:act");
  const people = useLoad(() => api.alertAssignees(), "assignees", canAct);

  // The search box waits for a pause in typing before asking the API.
  useEffect(() => {
    if (search === q) return;
    const timer = window.setTimeout(() => setQ(search), 250);
    return () => window.clearTimeout(timer);
  }, [search, q]);

  // The address bar follows the open alert and the severity chosen, so a reload or a shared link
  // lands on the same view.
  useEffect(() => {
    const params = new URLSearchParams();
    if (severity) params.set("severity", severity);
    if (open) params.set("alert", open);
    const search = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${search ? `?${search}` : ""}`,
    );
  }, [open, severity]);

  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const items = list.data?.items ?? [];
  const now = list.data?.now ?? null;
  const counts = list.data?.counts;
  const filtered = severity !== "" || type !== "" || project !== "" || mine || q !== "";
  const total = counts ? counts.critical + counts.action_needed + counts.info : 0;
  const chosen = items.filter((a) => selected.has(a.id));
  const openTitle = items.find((a) => a.id === open)?.title;

  function reset(change: () => void) {
    change();
    setSelected(new Set());
    setBulk(null);
    setBanner(null);
  }

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function runBulk(
    body: { action: "snooze"; until: string } | { action: "assign"; user_id: string },
    success: string,
  ) {
    setBusy(true);
    setBanner(null);
    try {
      const { changed: n } = await api.bulkAlerts({ ids: chosen.map((a) => a.id), ...body });
      setBanner({ tone: "success", text: `${success} (${n} ${n === 1 ? "alert" : "alerts"}).` });
      setSelected(new Set());
      setBulk(null);
      changed();
    } catch (e) {
      setBanner({
        tone: "error",
        text: e instanceof ApiError ? e.message : "Couldn’t change them. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  const summary = !counts
    ? "Loading alerts"
    : `${counts.critical + counts.action_needed} need attention${
        counts.info ? `, ${counts.info} for information` : ""
      }${list.data?.snoozed ? `, ${list.data.snoozed} snoozed` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">To-do</h1>
        <p className="text-sm text-muted" aria-live="polite">
          {summary}
          {list.data && <span className="text-subtle"> · {lastRunText(list.data.last_run)}</span>}
        </p>
      </header>

      {banner && (
        <p
          role={banner.tone === "error" ? "alert" : "status"}
          className={`m-0 rounded-control px-3 py-2 text-sm ${
            banner.tone === "error"
              ? "bg-danger-soft text-danger-text"
              : "bg-success-soft text-success-text"
          }`}
        >
          {banner.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SlidingTabs
          label="Which alerts"
          value={view}
          onChange={(id) => reset(() => setView(id as View))}
          tabs={[
            { id: "open", label: "Open", count: total },
            { id: "snoozed", label: "Snoozed", count: list.data?.snoozed },
            { id: "cleared", label: "Cleared" },
          ]}
        />
        {view === "open" && (
          <SlidingTabs
            label="Severity"
            value={severity}
            onChange={(id) => reset(() => setSeverity(id as AlertSeverity | ""))}
            tabs={[
              { id: "", label: "All", count: counts ? total : undefined },
              { id: "critical", label: "Critical", count: counts?.critical },
              { id: "action_needed", label: "Action needed", count: counts?.action_needed },
              { id: "info", label: "Info", count: counts?.info },
            ]}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1 sm:max-w-80">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search alerts"
            placeholder="Search alerts"
            className={`${FIELD} pl-9`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter by type"
          className={`${FIELD} w-auto!`}
          value={type}
          onChange={(e) => reset(() => setType(e.target.value as AlertType | ""))}
        >
          <option value="">Every type</option>
          {(Object.keys(TYPE_LABEL) as AlertType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by project"
          className={`${FIELD} w-auto! max-w-56`}
          value={project}
          onChange={(e) => reset(() => setProject(e.target.value))}
        >
          <option value="">Every project</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
        {canAct && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={mine}
              onChange={(e) => reset(() => setMine(e.target.checked))}
              className="size-4 accent-accent-hover"
            />
            Assigned to me
          </label>
        )}
      </div>

      {chosen.length > 0 && canAct && view === "open" && (
        <section
          aria-label="Bulk actions"
          className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="m-0 mr-2 text-sm font-medium" aria-live="polite">
              {chosen.length} selected
            </p>
            <button
              type="button"
              className={BUTTON}
              aria-expanded={bulk === "snooze"}
              onClick={() => setBulk(bulk === "snooze" ? null : "snooze")}
            >
              Snooze
            </button>
            <button
              type="button"
              className={BUTTON}
              aria-expanded={bulk === "assign"}
              onClick={() => setBulk(bulk === "assign" ? null : "assign")}
            >
              Assign
            </button>
            <button type="button" className={BUTTON} onClick={() => reset(() => undefined)}>
              Clear selection
            </button>
            <span className="text-xs text-muted">
              Each dismissal needs its own reason, so it is one at a time.
            </span>
          </div>
          {bulk === "snooze" && now && (
            <SnoozePanel
              now={now}
              severity={worst(chosen)}
              busy={busy}
              onCancel={() => setBulk(null)}
              onSnooze={(until) =>
                runBulk({ action: "snooze", until }, `Snoozed until ${formatDate(gulfDay(until))}`)
              }
            />
          )}
          {bulk === "assign" && (
            <form
              aria-label="Assign the selected alerts"
              className="flex flex-wrap items-end gap-2 rounded-control border border-border bg-sunken p-3"
              onSubmit={(e) => {
                e.preventDefault();
                const name = people.data?.find((p) => p.id === assignTo)?.name ?? "them";
                void runBulk({ action: "assign", user_id: assignTo }, `Assigned to ${name}`);
              }}
            >
              <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs text-muted">
                Assign to
                <select
                  className={FIELD}
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                >
                  <option value="">Choose a person</option>
                  {(people.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.role}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={PRIMARY_BUTTON} disabled={busy || !assignTo}>
                {busy ? "Assigning…" : "Assign"}
              </button>
            </form>
          )}
        </section>
      )}

      <section aria-label="Alerts" className="rounded-card border border-border bg-surface">
        {list.error && !list.data ? (
          <div className="p-5">
            <ErrorState title="Couldn’t load the alerts" onRetry={list.retry}>
              {list.error}
            </ErrorState>
          </div>
        ) : list.loading ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Loading alerts"
            className="flex flex-col gap-3 p-4"
          >
            {[0, 1, 2, 3, 4].map((n) => (
              <div key={n} className="skeleton h-9 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={filtered ? SearchX : CircleCheck}
            title={
              filtered
                ? "No alerts match these filters"
                : view === "open"
                  ? "No open alerts"
                  : view === "snoozed"
                    ? "Nothing is snoozed"
                    : "Nothing cleared yet"
            }
            action={
              filtered ? (
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => {
                    reset(() => {
                      setSeverity("");
                      setType("");
                      setProject("");
                      setMine(false);
                      setSearch("");
                      setQ("");
                    });
                  }}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          >
            {filtered
              ? "Try a different search, or clear the filters."
              : view === "open"
                ? lastRunText(list.data?.last_run ?? null)
                : view === "snoozed"
                  ? "Alerts you snooze wait here and come back at the time you chose."
                  : "Alerts that were resolved or dismissed in the last 30 days appear here."}
          </EmptyState>
        ) : (
          <>
            {canAct && view === "open" && (
              <label className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted">
                <input
                  type="checkbox"
                  aria-label="Select every alert in the list"
                  checked={items.length > 0 && items.every((a) => selected.has(a.id))}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set(items.map((a) => a.id)) : new Set())
                  }
                  className="size-4 accent-accent-hover"
                />
                Select all {items.length}
              </label>
            )}
            <AlertItems
              alerts={items}
              label={
                view === "open"
                  ? "Open alerts"
                  : view === "snoozed"
                    ? "Snoozed alerts"
                    : "Cleared alerts"
              }
              now={now ?? new Date().toISOString()}
              selectable={canAct && view === "open"}
              selected={selected}
              onToggle={toggle}
              onOpen={(a) => setOpen(a.id)}
            />
          </>
        )}
      </section>

      <AlertSheet
        alertId={open}
        fallbackTitle={openTitle}
        now={now}
        onClose={() => setOpen(null)}
        onChanged={changed}
      />
    </div>
  );
}
