"use client";

import { CircleCheck, Download, FileSpreadsheet } from "lucide-react";
import { useRef, useState } from "react";
import { BUTTON, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api } from "@/lib/api";
import type { EmpImportApplied, EmpImportSummary } from "@/lib/api-types";
import { messageOf } from "./shared";

type Props = { onChanged: () => void };

/**
 * Add people from an Excel list. Staff and labour are sorted per row, people already here are ignored,
 * and every doubtful row becomes a question HR answers before anything is written.
 */
export function EmployeeListImport({ onChanged }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<EmpImportSummary | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [raise, setRaise] = useState(false);
  const [done, setDone] = useState<EmpImportApplied | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setAnswers({});
    setRaise(false);
    setDone(null);
    setProblem(null);
  }

  async function run(apply: boolean) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await api.importEmployees(file, answers, apply, raise);
      if (apply) {
        setDone(result.applied);
        onChanged();
      } else {
        setPreview(result);
        setAnswers({});
      }
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const open = preview ? preview.conflicts.filter((c) => !answers[String(c.row)]).length : 0;
  const nothingToDo = preview !== null && preview.new === 0 && preview.conflicts.length === 0;
  const mayGrow = preview !== null && (preview.overflow.length > 0 || preview.conflicts.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {done && (
        <section aria-label="Result" className="flex flex-col gap-2">
          <p
            role="status"
            className="m-0 flex gap-2 rounded-control bg-success-soft p-3 text-sm text-success-text"
          >
            <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Added {done.created.staff} staff and {done.created.labour} labour
              {done.ai_placed > 0 && ` (the AI placed ${done.ai_placed})`}. Transferred{" "}
              {done.transferred}, updated {done.updated}, left out {done.ignored}, already here{" "}
              {done.unchanged}.
            </span>
          </p>
          {[...done.blocked, ...done.skipped].map((m) => (
            <p
              key={m}
              role="alert"
              className="m-0 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-text"
            >
              {m}
            </p>
          ))}
          <div>
            <button type="button" className={BUTTON} onClick={reset}>
              Import another file
            </button>
          </div>
        </section>
      )}

      {!done && (
        <>
          <p className="m-0 text-sm text-muted">
            One row per person: company ID, full name, designation, project, status. Staff and
            labour are sorted for you. A blank status becomes “Offer issued” and appears in
            Mobilization. If the sheet has no Project column, or a project is blank, the AI places
            that person on the project that needs the role most.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={picker}
              type="file"
              accept=".xlsx"
              className="sr-only"
              aria-label="Choose the Excel file"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setProblem(null);
              }}
            />
            <button type="button" className={BUTTON} onClick={() => picker.current?.click()}>
              <FileSpreadsheet className="size-4" aria-hidden="true" />
              {file ? file.name : "Choose the .xlsx file"}
            </button>
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={!file || busy}
              onClick={() => void run(false)}
            >
              {busy && !preview ? "Reading…" : "Preview"}
            </button>
          </div>
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span>Try it with a fictional file:</span>
            {(
              [
                ["new", "1. New people"],
                ["changes", "2. Duplicates and questions"],
              ] as const
            ).map(([which, label]) => (
              <a
                key={which}
                href={`/api/imports/employees/sample.xlsx?which=${which}`}
                download
                className="inline-flex items-center gap-1 font-medium text-info-text underline"
              >
                <Download className="size-3.5" aria-hidden="true" />
                {label}
              </a>
            ))}
          </p>
        </>
      )}

      {problem && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {problem}
        </p>
      )}

      {preview && !done && (
        <section aria-label="What the file contains" className="flex flex-col gap-4">
          <dl className="m-0 text-sm">
            {[
              ["Rows read", preview.rows],
              ["New staff", preview.new_staff],
              ["New labour", preview.new_labour],
              ["Already here (ignored)", preview.unchanged],
              ["Placed by the AI (no project given)", preview.ai_placed],
              ["Questions for you", preview.conflicts.length],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-4 border-b border-border py-2 last:border-b-0"
              >
                <dt className="text-muted">{label}</dt>
                <dd className="m-0 font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          {preview.new_roles.length > 0 && (
            <p className="m-0 rounded-control border border-border p-3 text-sm">
              <b>New roles will be created:</b> {preview.new_roles.join(", ")}. Check the spelling
              if one of them is a typo.
            </p>
          )}

          {preview.conflicts.map((c) => (
            <fieldset
              key={c.row}
              className="m-0 flex flex-col gap-2 rounded-control border border-border-strong p-3"
            >
              <legend className="px-1 text-xs font-medium text-muted">Row {c.row}</legend>
              <p className="m-0 text-sm">{c.question}</p>
              {c.options.map((o) => (
                <label
                  key={o.id}
                  className="flex cursor-pointer items-start gap-2 rounded-control border border-border px-3 py-2 text-sm has-checked:bg-hover has-checked:font-medium"
                >
                  <input
                    type="radio"
                    name={`q-${c.row}`}
                    className="mt-1"
                    checked={answers[String(c.row)] === o.id}
                    onChange={() => setAnswers((a) => ({ ...a, [String(c.row)]: o.id }))}
                  />
                  {o.label}
                </label>
              ))}
            </fieldset>
          ))}

          {preview.overflow.length > 0 && (
            <div className="rounded-control border border-border p-3 text-sm">
              <p className="m-0 font-medium">These places will be over their plan</p>
              <ul className="mt-2 mb-0 list-disc pl-5 text-xs text-muted">
                {preview.overflow.map((o) => (
                  <li key={`${o.project}-${o.designation}`}>
                    {o.project}, {o.designation}: planned {o.planned}, now {o.now}, after {o.after}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mayGrow && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={raise}
                onChange={(e) => setRaise(e.target.checked)}
              />
              <span>
                Raise a project’s plan when it is full, so everyone fits (also lets transfers into a
                full project go through). Left unticked, extra people show as over-filled and
                transfers into a full project wait.
              </span>
            </label>
          )}

          {preview.issues.length > 0 && (
            <details className="rounded-control border border-border p-3 text-sm">
              <summary className="cursor-pointer font-medium">
                {preview.issues.length} thing{preview.issues.length === 1 ? "" : "s"} to know
              </summary>
              <ul className="mt-2 mb-0 list-disc pl-5 text-xs text-muted">
                {preview.issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </details>
          )}

          {nothingToDo ? (
            <p className="m-0 text-sm text-muted">
              Everyone in this file is already here, so there is nothing to add.
            </p>
          ) : (
            <div>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={busy || open > 0}
                onClick={() => void run(true)}
              >
                {busy ? "Importing…" : "Import"}
              </button>
              <p className="mt-2 mb-0 text-xs text-muted">
                {open > 0
                  ? `Answer ${open} more question${open === 1 ? "" : "s"} to continue.`
                  : "Nothing is written until you press Import."}
              </p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
