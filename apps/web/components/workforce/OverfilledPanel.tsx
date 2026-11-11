"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api } from "@/lib/api";
import type { WOverfilled } from "@/lib/api-types";
import { useLoad } from "@/lib/use-load";
import { messageOf, StatusPill } from "./shared";

type Props = {
  detail: string;
  ask: WOverfilled;
  busy: boolean;
  /** HR agreed to plan one more place: send the same request again with resolve=increase_plan. */
  onRaise: () => void;
  onCancel: () => void;
  /** Someone else was moved or resigned, so the original request can be tried again. */
  onFreed: (notice: string) => void;
};

/**
 * The project is full. Nothing has been saved. HR chooses: plan one more place, move or resign
 * someone who is already there, or cancel.
 */
export function OverfilledPanel({ detail, ask, busy, onRaise, onCancel, onFreed }: Props) {
  const projects = useLoad(() => api.wProjects(), "w-projects");
  const [target, setTarget] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function act(code: string, name: string, kind: "move" | "resign") {
    setWorking(code);
    setProblem(null);
    try {
      if (kind === "resign") {
        await api.wMilestone(code, "resigned");
        onFreed(`${name} was marked as resigned. Try again.`);
      } else {
        await api.wMove(code, target[code]);
        onFreed(`${name} was moved. Try again.`);
      }
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setWorking(null);
    }
  }

  return (
    <section aria-label="This project is full" className="flex flex-col gap-4">
      <div
        role="alert"
        className="flex gap-2 rounded-control bg-warning-soft p-3 text-sm text-warning-text"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          <b>Over-filled.</b> {detail} Nothing has been saved yet.
        </span>
      </div>

      <div className="overflow-x-auto rounded-control border border-border">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">What the project plans and has</caption>
          <thead>
            <tr className="bg-sunken text-left text-xs text-muted">
              {["Project", "Designation", "Planned", "Now", "After"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ask.table.map((r) => (
              <tr key={r.project + r.designation} className="border-t border-border">
                <td className="px-3 py-2">{r.project}</td>
                <td className="px-3 py-2">{r.designation}</td>
                <td className="px-3 py-2 tabular-nums">{r.planned}</td>
                <td className="px-3 py-2 tabular-nums">{r.now}</td>
                <td className="px-3 py-2 font-semibold tabular-nums text-danger-text">{r.after}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={PRIMARY_BUTTON} disabled={busy} onClick={onRaise}>
          Raise the plan by 1 and continue
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>

      {ask.people.length > 0 && (
        <section
          aria-label="Or move or resign someone already there"
          className="flex flex-col gap-2"
        >
          <h3 className="m-0 text-sm font-semibold">Or free a place: move or resign someone</h3>
          {problem && (
            <p
              role="alert"
              className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
            >
              {problem}
            </p>
          )}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {ask.people.map((p) => (
              <li
                key={p.code}
                className="flex flex-wrap items-center gap-2 rounded-control border border-border px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{p.name}</span>
                  <span className="font-mono text-xs text-muted">{p.code}</span>
                </span>
                <StatusPill status={p.status} />
                <select
                  className={FIELD}
                  aria-label={`Move ${p.name} to`}
                  value={target[p.code] ?? ""}
                  onChange={(e) => setTarget({ ...target, [p.code]: e.target.value })}
                >
                  <option value="">Move to…</option>
                  {(projects.data ?? [])
                    .filter((x) => x.code !== ask.project)
                    .map((x) => (
                      <option key={x.code} value={x.code}>
                        {x.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={!target[p.code] || working !== null}
                  onClick={() => void act(p.code, p.name, "move")}
                >
                  Move
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={working !== null}
                  onClick={() => void act(p.code, p.name, "resign")}
                >
                  Resign
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
