"use client";

import { CircleAlert, CircleCheck } from "lucide-react";
import { useState } from "react";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { BUTTON, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { ProjectForecast, ReserveResult, TradeForecast } from "@/lib/api-types";
import { formatDate } from "@/lib/format";

type Choice = {
  code: string;
  name: string;
  level: number | null;
  /** What to tell HR about when and where they come from. */
  note: string;
  late: boolean;
};

/** Everyone the forecast lets HR pick, free-now and finishing-before-start first, late joiners last. */
function choices(trade: TradeForecast): Choice[] {
  const out: Choice[] = [];
  for (const source of trade.sources) {
    for (const w of source.workers) {
      out.push({
        code: w.code,
        name: w.name,
        level: w.level,
        late: false,
        note:
          source.kind === "available_now"
            ? "Free now"
            : `Finishes on ${source.project_code} on ${source.ends_on ? formatDate(source.ends_on) : "?"}, starts after`,
      });
    }
  }
  for (const c of trade.late_candidates) {
    out.push({
      code: c.code,
      name: c.name,
      level: c.level,
      late: true,
      note: `Finishes on ${c.project_code} on ${formatDate(c.ends_on)}, so starts late`,
    });
  }
  return out;
}

type Props = {
  open: boolean;
  onClose: () => void;
  forecast: ProjectForecast;
  trade: TradeForecast;
  /** Called after anything was saved, so the forecast can refresh. */
  onChanged: () => void;
};

/** Hold people for this project. Each person is checked again on the server, and the answers are shown. */
export function ReserveSheet({ open, onClose, forecast, trade, onChanged }: Props) {
  const list = choices(trade);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(list.filter((c) => !c.late).map((c) => c.code)),
  );
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [results, setResults] = useState<ReserveResult[] | null>(null);

  function toggle(code: string) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function close() {
    if (saving) return;
    onClose();
  }

  async function confirm() {
    setSaving(true);
    setFailure(null);
    try {
      const response = await api.reserve(
        forecast.project.code,
        trade.trade_code,
        [...picked],
        forecast.start,
      );
      setResults(response.results);
      if (response.reserved > 0) onChanged();
    } catch (error) {
      setFailure(error instanceof ApiError ? error.message : "Couldn’t reserve. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const late = list.filter((c) => picked.has(c.code) && c.late).length;
  const dependent = list.filter(
    (c) => picked.has(c.code) && !c.late && !c.note.startsWith("Free now"),
  ).length;

  return (
    <DetailSheet
      open={open}
      onOpenChange={(next) => !next && close()}
      title={`Reserve ${trade.trade.toLowerCase()} people`}
      meta={
        <span>
          for {forecast.project.code} {forecast.project.name}
        </span>
      }
    >
      {results ? (
        <div className="flex flex-col gap-4" aria-live="polite">
          <p className="m-0 text-sm">
            {results.filter((r) => r.outcome === "reserved").length} of {results.length} reserved.
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {results.map((r) => (
              <li
                key={r.code}
                className="flex items-start gap-2 rounded-control border border-border p-3 text-sm"
              >
                {r.outcome === "reserved" ? (
                  <CircleCheck
                    className="mt-0.5 size-4 shrink-0 text-success-text"
                    aria-hidden="true"
                  />
                ) : (
                  <CircleAlert
                    className="mt-0.5 size-4 shrink-0 text-danger-text"
                    aria-hidden="true"
                  />
                )}
                <span>
                  <span className="font-medium">{r.name}</span>{" "}
                  <span className="font-mono text-xs text-subtle">{r.code}</span>
                  <br />
                  {r.outcome === "reserved" ? (
                    <span className="text-muted">
                      Reserved from {r.starts_on ? formatDate(r.starts_on) : ""}
                      {r.moving_from ? `, after leaving ${r.moving_from}` : ""}.
                    </span>
                  ) : (
                    <span className="text-danger-text">Not reserved: {r.reason}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div>
            <button type="button" className={PRIMARY_BUTTON} onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {list.length === 0 ? (
            <p className="m-0 text-sm text-muted">
              Nobody can be reserved for this trade yet. Raise a recruitment request instead.
            </p>
          ) : (
            <>
              <p className="m-0 text-sm text-muted">
                Choose who to hold for this project. People who could join late are not ticked: tick
                them only if you accept the later start.
              </p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {list.map((c) => (
                  <li key={c.code}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-control border border-border p-3 text-sm hover:bg-hover">
                      <input
                        type="checkbox"
                        checked={picked.has(c.code)}
                        onChange={() => toggle(c.code)}
                        className="mt-0.5 size-4 accent-[var(--accent-hover)]"
                      />
                      <span>
                        <span className="font-medium">{c.name}</span>{" "}
                        <span className="font-mono text-xs text-subtle">{c.code}</span>
                        {c.level ? <span className="text-muted"> · level {c.level}</span> : null}
                        <br />
                        <span className={c.late ? "text-warning-text" : "text-muted"}>
                          {c.note}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p role="status" className="m-0 rounded-control bg-sunken p-3 text-sm">
                {picked.size === 0
                  ? "Nobody ticked yet."
                  : `You will reserve ${picked.size} ${picked.size === 1 ? "person" : "people"}.` +
                    (dependent
                      ? ` ${dependent} start only after they finish on another project, so they depend on that job ending on time.`
                      : "") +
                    (late ? ` ${late} will start later than ${formatDate(forecast.start)}.` : "")}
              </p>
            </>
          )}
          {failure && (
            <p
              role="alert"
              className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
            >
              {failure}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={saving || picked.size === 0}
              onClick={confirm}
            >
              {saving ? "Reserving…" : `Reserve ${picked.size || ""}`.trim()}
            </button>
            <button type="button" className={BUTTON} onClick={close} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </DetailSheet>
  );
}
