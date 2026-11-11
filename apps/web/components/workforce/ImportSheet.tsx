"use client";

import { FileSpreadsheet } from "lucide-react";
import { useRef, useState } from "react";
import { BUTTON, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { api } from "@/lib/api";
import type { TrackerSummary, WKind } from "@/lib/api-types";
import { messageOf } from "./shared";

type Props = { open: boolean; onClose: () => void; onChanged: () => void };

const STATUS_WORD: Record<string, string> = {
  active: "Joined",
  offer_issued: "Offer issued",
  documents_cleared: "Documents cleared",
  vacancy: "Empty positions",
  resigned: "Resigned",
  terminated: "Terminated",
  absconded: "Left without notice",
  transfer_out: "Transfer out planned",
  transfer_in: "Transfer in planned",
  on_leave: "On leave",
};

/** Import the labour or staff tracker: see what it contains first, then import it. */
export function ImportSheet({ open, onClose, onChanged }: Props) {
  const [kind, setKind] = useState<WKind>("labour");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TrackerSummary | null>(null);
  const [done, setDone] = useState<TrackerSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setDone(null);
    setProblem(null);
  }

  async function run(apply: boolean) {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const summary = await api.importTracker(kind, file, apply);
      if (apply) {
        setDone(summary);
        onChanged();
      } else setPreview(summary);
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  const shown = done ?? preview;
  return (
    <DetailSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
      title="Import from Excel"
      meta="The labour or staff tracker"
    >
      <div className="flex flex-col gap-4">
        {done && (
          <p
            role="status"
            className="m-0 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
          >
            Imported {done.people} people and {done.plan_lines} planned lines from the {done.kind}{" "}
            tracker.
          </p>
        )}
        <fieldset className="m-0 flex gap-2 border-0 p-0">
          <legend className="mb-1 text-xs font-medium text-muted">Which tracker</legend>
          {(["labour", "staff"] as const).map((k) => (
            <label
              key={k}
              className="flex cursor-pointer items-center gap-2 rounded-control border border-border-strong px-3 py-1.5 text-sm has-checked:bg-hover has-checked:font-medium"
            >
              <input
                type="radio"
                name="tracker-kind"
                checked={kind === k}
                onChange={() => {
                  setKind(k);
                  reset();
                }}
              />
              {k === "labour" ? "Labour" : "Staff"}
            </label>
          ))}
        </fieldset>
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
              setDone(null);
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
        {problem && (
          <p
            role="alert"
            className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
          >
            {problem}
          </p>
        )}

        {shown && (
          <section aria-label="What the file contains" className="flex flex-col gap-3">
            <dl className="m-0 text-sm">
              {[
                ["Rows read", shown.rows],
                ["People", shown.people],
                ["Empty positions to recruit", shown.vacancies],
                ["Planned places in total", shown.planned_total],
                ["UAE-nationals-only role lines", shown.uae_only_lines],
                ["Planned transfers noted (not applied)", shown.transfers_noted],
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
            <p className="m-0 text-xs text-muted">
              {Object.entries(shown.by_status)
                .map(([s, n]) => `${STATUS_WORD[s] ?? s}: ${n}`)
                .join(" · ")}
            </p>
            {shown.issue_count > 0 && (
              <details className="rounded-control border border-border p-3 text-sm">
                <summary className="cursor-pointer font-medium">
                  {shown.issue_count} thing{shown.issue_count === 1 ? "" : "s"} to know
                </summary>
                <ul className="mt-2 mb-0 list-disc pl-5 text-xs text-muted">
                  {shown.issues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </details>
            )}
            {!done && (
              <div>
                <button
                  type="button"
                  className={PRIMARY_BUTTON}
                  disabled={busy}
                  onClick={() => void run(true)}
                >
                  {busy ? "Importing…" : "Import these"}
                </button>
                <p className="mt-2 mb-0 text-xs text-muted">
                  People are matched by their company ID, so importing again does not double anyone.
                  Planned counts are replaced by what the sheet says.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </DetailSheet>
  );
}
