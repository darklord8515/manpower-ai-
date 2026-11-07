"use client";

import { useId, useState } from "react";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { ProjectDatesBody, ProjectRow } from "@/lib/api-types";

type Props = {
  /** The project to change; null closes the sheet. */
  project: ProjectRow | null;
  onClose: () => void;
  onSaved: (project: ProjectRow) => void;
};

/** What the person typed, checked the way the API checks it. */
export function checkDates(
  starts: string,
  ends: string,
  was: { starts: string | null; ends: string | null },
): { body: ProjectDatesBody | null; problem: string | null } {
  if (!starts || !ends) return { body: null, problem: "Choose both dates." };
  if (ends < starts)
    return { body: null, problem: "The end date must not be before the start date." };
  const body: ProjectDatesBody = {};
  if (starts !== was.starts) body.starts_on = starts;
  if (ends !== was.ends) body.ends_on = ends;
  return Object.keys(body).length
    ? { body, problem: null }
    : { body: null, problem: "Change a date first." };
}

function Form({ project, onClose, onSaved }: Omit<Props, "project"> & { project: ProjectRow }) {
  const ids = useId();
  const [starts, setStarts] = useState(project.starts ?? "");
  const [ends, setEnds] = useState(project.ends ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const check = checkDates(starts, ends, { starts: project.starts, ends: project.ends });
  // Say why Save is off as soon as the dates stop making sense, not only after pressing it.
  const edited = starts !== (project.starts ?? "") || ends !== (project.ends ?? "");
  const shown = problem ?? (edited ? check.problem : null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!check.body) {
      setProblem(check.problem);
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      onSaved(await api.changeProjectDates(project.code, check.body));
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : "Couldn’t save the dates. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <p className="m-0 text-sm text-muted">
        People already placed on {project.code} keep the dates they were given. The forecast and the
        alerts follow the new dates straight away.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted" htmlFor={`${ids}-starts`}>
          Starts
          <input
            id={`${ids}-starts`}
            type="date"
            className={FIELD}
            value={starts}
            aria-invalid={Boolean(problem)}
            onChange={(e) => setStarts(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted" htmlFor={`${ids}-ends`}>
          Ends
          <input
            id={`${ids}-ends`}
            type="date"
            className={FIELD}
            min={starts || undefined}
            value={ends}
            aria-invalid={Boolean(problem)}
            onChange={(e) => setEnds(e.target.value)}
          />
        </label>
      </div>
      {shown && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {shown}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={saving || !check.body}>
          {saving ? "Saving…" : "Save dates"}
        </button>
        <button type="button" className={BUTTON} onClick={onClose} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Move a project's start or end date. The detectors run on save, so alerts update at once. */
export function EditDatesSheet({ project, onClose, onSaved }: Props) {
  return (
    <DetailSheet
      open={project !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Change project dates"
      meta={
        project && (
          <>
            <span className="font-mono">{project.code}</span>
            <span>{project.name}</span>
          </>
        )
      }
    >
      {project && <Form key={project.code} project={project} onClose={onClose} onSaved={onSaved} />}
    </DetailSheet>
  );
}
