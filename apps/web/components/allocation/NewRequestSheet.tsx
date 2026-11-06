"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { ProjectRow, RequestDetail, Trade } from "@/lib/api-types";
import {
  PRIORITIES,
  emptyForm,
  hasErrors,
  toPayload,
  validate,
  type RequestErrors,
  type RequestForm,
} from "./new-request";

type Props = {
  open: boolean;
  onClose: () => void;
  projects: ProjectRow[];
  trades: Trade[];
  onCreated: (request: RequestDetail) => void;
};

function Problem({ id, children }: { id: string; children?: string }) {
  return (
    <p
      id={id}
      role={children ? "alert" : undefined}
      className="m-0 text-xs text-danger-text empty:hidden"
    >
      {children}
    </p>
  );
}

/** Ask for workers: one project, the dates, and how many of each trade (with a minimum level). */
export function NewRequestSheet({ open, onClose, projects, trades, onCreated }: Props) {
  const ids = useId();
  const nextId = useRef(2);
  const [form, setForm] = useState<RequestForm>(emptyForm);
  const [errors, setErrors] = useState<RequestErrors>({ line: {} });
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const change = (changes: Partial<RequestForm>) => setForm((f) => ({ ...f, ...changes }));
  const changeLine = (id: number, changes: Partial<RequestForm["lines"][number]>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, ...changes } : l)) }));

  function reset() {
    setForm(emptyForm());
    nextId.current = 2;
    setErrors({ line: {} });
    setFailure(null);
  }

  function close() {
    if (saving) return;
    reset();
    onClose();
  }

  // Choosing a project fills in its dates, which HR can still change.
  function chooseProject(code: string) {
    const project = projects.find((p) => p.code === code);
    setForm((f) => ({
      ...f,
      project: code,
      needed_from: f.needed_from || project?.starts || "",
      needed_until: f.needed_until || project?.ends || "",
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate(form);
    setErrors(found);
    setFailure(null);
    if (hasErrors(found)) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setSaving(true);
    try {
      const created = await api.raiseRequest(toPayload(form));
      reset();
      onCreated(created);
    } catch (error) {
      setFailure(
        error instanceof ApiError ? error.message : "Couldn’t save the request. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const taken = new Set(form.lines.map((l) => l.trade).filter(Boolean));
  const choosable = projects.filter((p) => p.status !== "completed" && p.status !== "cancelled");

  return (
    <DetailSheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title="New staffing request"
      meta={<span>It goes to the HR Manager for approval.</span>}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-project`} className="text-sm font-medium">
            Project
          </label>
          <select
            id={`${ids}-project`}
            className={FIELD}
            value={form.project}
            aria-invalid={Boolean(errors.project)}
            aria-describedby={`${ids}-project-error`}
            onChange={(e) => chooseProject(e.target.value)}
          >
            <option value="">Choose a project</option>
            {choosable.map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
              </option>
            ))}
          </select>
          <Problem id={`${ids}-project-error`}>{errors.project}</Problem>
        </div>

        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-medium">Needed</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              From
              <input
                type="date"
                className={FIELD}
                value={form.needed_from}
                aria-invalid={Boolean(errors.dates)}
                aria-describedby={`${ids}-dates-error`}
                onChange={(e) => change({ needed_from: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Until (optional)
              <input
                type="date"
                className={FIELD}
                min={form.needed_from || undefined}
                value={form.needed_until}
                aria-invalid={Boolean(errors.dates)}
                aria-describedby={`${ids}-dates-error`}
                onChange={(e) => change({ needed_until: e.target.value })}
              />
            </label>
          </div>
          <Problem id={`${ids}-dates-error`}>{errors.dates}</Problem>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-priority`} className="text-sm font-medium">
            Priority
          </label>
          <select
            id={`${ids}-priority`}
            className={FIELD}
            value={form.priority}
            onChange={(e) => change({ priority: e.target.value })}
          >
            {PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-medium">Workers needed</legend>
          {form.lines.map((line, index) => {
            const problem = errors.line[line.id];
            return (
              <div key={line.id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-start gap-2">
                  <select
                    aria-label={`Trade ${index + 1}`}
                    className={`${FIELD} basis-full sm:basis-0 sm:flex-1`}
                    value={line.trade}
                    aria-invalid={Boolean(problem?.trade)}
                    onChange={(e) => changeLine(line.id, { trade: e.target.value })}
                  >
                    <option value="">Choose a trade</option>
                    {trades.map((t) => (
                      <option
                        key={t.code}
                        value={t.code}
                        disabled={taken.has(t.code) && line.trade !== t.code}
                      >
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={500}
                    aria-label={`How many ${index + 1}`}
                    placeholder="How many"
                    className={`${FIELD} w-28! shrink-0`}
                    value={line.headcount}
                    aria-invalid={Boolean(problem?.headcount)}
                    onChange={(e) => changeLine(line.id, { headcount: e.target.value })}
                  />
                  <select
                    aria-label={`Minimum level ${index + 1}`}
                    className={`${FIELD} w-28! shrink-0`}
                    value={line.min_level}
                    onChange={(e) => changeLine(line.id, { min_level: e.target.value })}
                  >
                    <option value="">Any level</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        Level {n}+
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove trade ${index + 1}`}
                    disabled={form.lines.length === 1}
                    onClick={() =>
                      setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.id !== line.id) }))
                    }
                    className="press grid size-9 shrink-0 place-items-center rounded-control text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <Problem id={`${ids}-line-${line.id}-trade`}>{problem?.trade}</Problem>
                <Problem id={`${ids}-line-${line.id}-headcount`}>{problem?.headcount}</Problem>
              </div>
            );
          })}
          <Problem id={`${ids}-lines-error`}>{errors.lines}</Problem>
          <div>
            <button
              type="button"
              className={BUTTON}
              disabled={form.lines.length >= 20 || form.lines.length >= trades.length}
              onClick={() => {
                const id = nextId.current++;
                setForm((f) => ({
                  ...f,
                  lines: [...f.lines, { id, trade: "", headcount: "", min_level: "" }],
                }));
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add a trade
            </button>
          </div>
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-note`} className="text-sm font-medium">
            Note (optional)
          </label>
          <textarea
            id={`${ids}-note`}
            rows={3}
            maxLength={1000}
            className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm placeholder:text-subtle"
            value={form.note}
            onChange={(e) => change({ note: e.target.value })}
            placeholder="Anything the approver should know"
          />
        </div>

        {failure && (
          <p
            role="alert"
            className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
          >
            {failure}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button type="submit" className={PRIMARY_BUTTON} disabled={saving}>
            {saving ? "Sending…" : "Send request"}
          </button>
          <button type="button" className={BUTTON} onClick={close} disabled={saving}>
            Cancel
          </button>
        </div>
      </form>
    </DetailSheet>
  );
}
