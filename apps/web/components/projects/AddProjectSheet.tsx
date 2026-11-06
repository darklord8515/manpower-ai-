"use client";

import { Plus, Trash2 } from "lucide-react";
import { useId, useRef, useState } from "react";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { ProjectRow, Trade } from "@/lib/api-types";
import {
  emptyForm,
  hasErrors,
  toPayload,
  validate,
  type ProjectErrors,
  type ProjectForm,
} from "./new-project";

type Props = {
  open: boolean;
  onClose: () => void;
  trades: Trade[];
  onCreated: (project: ProjectRow) => void;
};

function Error({ id, children }: { id: string; children?: string }) {
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

/** Add a project: its name, dates and how many of each trade it needs. HR sees the forecast next. */
export function AddProjectSheet({ open, onClose, trades, onCreated }: Props) {
  const ids = useId();
  const nextId = useRef(2);
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [errors, setErrors] = useState<ProjectErrors>({ line: {} });
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function change(changes: Partial<ProjectForm>) {
    setForm((f) => ({ ...f, ...changes }));
  }
  function changeLine(id: number, changes: Partial<ProjectForm["lines"][number]>) {
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.id === id ? { ...l, ...changes } : l)) }));
  }

  function close() {
    if (saving) return;
    setForm(emptyForm());
    nextId.current = 2;
    setErrors({ line: {} });
    setFailure(null);
    onClose();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate(form);
    setErrors(found);
    setFailure(null);
    if (hasErrors(found)) {
      // Take the person to the first thing to fix.
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    setSaving(true);
    try {
      const project = await api.createProject(toPayload(form));
      setForm(emptyForm());
      nextId.current = 2;
      onCreated(project);
    } catch (error) {
      setFailure(
        error instanceof ApiError ? error.message : "Couldn’t save the project. Try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const taken = new Set(form.lines.map((l) => l.trade).filter(Boolean));

  return (
    <DetailSheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Add a project"
      meta={<span>It starts in planning. The forecast is the next screen.</span>}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${ids}-name`} className="text-sm font-medium">
            Project name
          </label>
          <input
            id={`${ids}-name`}
            className={FIELD}
            value={form.name}
            maxLength={120}
            autoComplete="off"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={`${ids}-name-error`}
            onChange={(e) => change({ name: e.target.value })}
            placeholder="For example, Al Hamra Marina Towers"
          />
          <Error id={`${ids}-name-error`}>{errors.name}</Error>
        </div>

        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-medium">Dates</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-muted">
              Starts
              <input
                type="date"
                className={FIELD}
                value={form.starts_on}
                aria-invalid={Boolean(errors.dates)}
                aria-describedby={`${ids}-dates-error`}
                onChange={(e) => change({ starts_on: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted">
              Ends
              <input
                type="date"
                className={FIELD}
                min={form.starts_on || undefined}
                value={form.ends_on}
                aria-invalid={Boolean(errors.dates)}
                aria-describedby={`${ids}-dates-error`}
                onChange={(e) => change({ ends_on: e.target.value })}
              />
            </label>
          </div>
          <Error id={`${ids}-dates-error`}>{errors.dates}</Error>
        </fieldset>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.outdoor}
            onChange={(e) => change({ outdoor: e.target.checked })}
            className="size-4 accent-[var(--accent-hover)]"
          />
          Outdoor site (the summer midday work ban applies)
        </label>

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-sm font-medium">Workers needed</legend>
          {form.lines.map((line, index) => {
            const problem = errors.line[line.id];
            return (
              <div key={line.id} className="flex flex-col gap-1">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <select
                      aria-label={`Trade ${index + 1}`}
                      className={FIELD}
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
                  </div>
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
                {(problem?.trade || problem?.headcount) && (
                  <Error id={`${ids}-line-${line.id}`}>{problem.trade ?? problem.headcount}</Error>
                )}
              </div>
            );
          })}
          <Error id={`${ids}-lines-error`}>{errors.lines}</Error>
          <div>
            <button
              type="button"
              className={BUTTON}
              disabled={form.lines.length >= 20 || form.lines.length >= trades.length}
              onClick={() => {
                const id = nextId.current++;
                setForm((f) => ({ ...f, lines: [...f.lines, { id, trade: "", headcount: "" }] }));
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add a trade
            </button>
          </div>
        </fieldset>

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
            {saving ? "Saving…" : "Create project"}
          </button>
          <button type="button" className={BUTTON} onClick={close} disabled={saving}>
            Cancel
          </button>
        </div>
      </form>
    </DetailSheet>
  );
}
