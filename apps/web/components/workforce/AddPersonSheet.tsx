"use client";

import { Bot, CircleCheck } from "lucide-react";
import { useState } from "react";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { api, ApiError } from "@/lib/api";
import type { AddPersonBody, WOverfilled, WPlacement } from "@/lib/api-types";
import { useLoad } from "@/lib/use-load";
import { OverfilledPanel } from "./OverfilledPanel";
import { messageOf } from "./shared";

type Props = { open: boolean; onClose: () => void; onChanged: () => void };

/** Add one person: choose their project, or let the AI place them where they are needed most. */
export function AddPersonSheet({ open, onClose, onChanged }: Props) {
  const projects = useLoad(() => api.wProjects(), "w-projects", open);
  const roles = useLoad(() => api.wDesignations(), "w-designations", open);
  const [name, setName] = useState("");
  const [designation, setDesignation] = useState("");
  const [status, setStatus] = useState<NonNullable<AddPersonBody["status"]>>("offer_issued");
  const [code, setCode] = useState("");
  const [expected, setExpected] = useState("");
  const [uae, setUae] = useState(false);
  const [how, setHow] = useState<"project" | "auto">("auto");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ detail: string; data: WOverfilled } | null>(null);
  const [done, setDone] = useState<WPlacement | null>(null);

  const ready = name.trim().length >= 2 && designation !== "" && (how === "auto" || project !== "");
  const body = (resolve?: "increase_plan"): AddPersonBody => ({
    name: name.trim(),
    designation,
    status,
    code: code.trim() || null,
    uae_national: uae,
    ...(status !== "active" && expected ? { expected_join_on: expected } : {}),
    ...(how === "auto" ? { auto: true } : { project_code: project }),
    ...(resolve ? { resolve } : {}),
  });

  async function submit(resolve?: "increase_plan") {
    setBusy(true);
    setProblem(null);
    try {
      setDone(await api.wAddPerson(body(resolve)));
      setAsk(null);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.overfilled) setAsk({ detail: e.message, data: e.overfilled });
      else setProblem(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  function again() {
    setName("");
    setCode("");
    setDone(null);
    setAsk(null);
    setProblem(null);
  }

  const staff = (roles.data ?? []).filter((r) => r.kind === "staff");
  const labour = (roles.data ?? []).filter((r) => r.kind === "labour");
  return (
    <DetailSheet
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          again();
          onClose();
        }
      }}
      title="Add a person"
      meta="Staff or labour, placed on a project"
    >
      {done ? (
        <section aria-label="Added" className="flex flex-col gap-3">
          <p
            role="status"
            className="m-0 flex gap-2 rounded-control bg-success-soft p-3 text-sm text-success-text"
          >
            <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{done.message}</span>
          </p>
          {done.decided_by === "ai" && done.reason && (
            <p className="m-0 flex gap-2 rounded-control border border-border p-3 text-sm">
              <Bot className="mt-0.5 size-4 shrink-0 text-info-text" aria-hidden="true" />
              <span>
                <b>Why the AI chose this:</b> {done.reason}
              </span>
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className={PRIMARY_BUTTON} onClick={again}>
              Add another
            </button>
            <button type="button" className={BUTTON} onClick={onClose}>
              Close
            </button>
          </div>
        </section>
      ) : ask ? (
        <OverfilledPanel
          detail={ask.detail}
          ask={ask.data}
          busy={busy}
          onRaise={() => void submit("increase_plan")}
          onCancel={() => setAsk(null)}
          onFreed={() => void submit()}
        />
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) void submit();
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Full name
            <input
              className={FIELD}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Designation
            <select
              className={FIELD}
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
            >
              <option value="">Choose a role…</option>
              <optgroup label="Staff">
                {staff.map((r) => (
                  <option key={`s-${r.name}`} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Labour">
                {labour.map((r) => (
                  <option key={`l-${r.name}`} value={r.name}>
                    {r.name}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Mobilization step
              <select
                className={FIELD}
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
              >
                <option value="offer_issued">Offer issued (goes to Mobilization)</option>
                <option value="documents_cleared">Documents cleared (goes to Mobilization)</option>
                <option value="active">Already joined (not in Mobilization)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Company ID (if they have one)
              <input
                className={FIELD}
                value={code}
                maxLength={30}
                onChange={(e) => setCode(e.target.value)}
              />
            </label>
          </div>
          {status !== "active" && (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Expected joining date (you can change it later in Mobilization)
              <input
                type="date"
                className={FIELD}
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
              />
            </label>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={uae} onChange={(e) => setUae(e.target.checked)} />
            UAE national
          </label>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-xs font-medium text-muted">Which project</legend>
            {(
              [
                [
                  "auto",
                  "Let AI decide",
                  "It places them on the project where this role is needed most, and says why. It only chooses projects.",
                ],
                ["project", "I will choose (any project, head office or camp)", ""],
              ] as const
            ).map(([id, label, hint]) => (
              <label
                key={id}
                className="flex cursor-pointer items-start gap-2 rounded-control border border-border-strong px-3 py-2 text-sm has-checked:bg-hover"
              >
                <input
                  type="radio"
                  name="how"
                  className="mt-1"
                  checked={how === id}
                  onChange={() => setHow(id)}
                />
                <span>
                  <span className="font-medium">{label}</span>
                  {hint && <span className="block text-xs text-muted">{hint}</span>}
                </span>
              </label>
            ))}
            {how === "project" && (
              <select
                className={FIELD}
                aria-label="Project"
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">Choose a project…</option>
                {(projects.data ?? []).map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </fieldset>

          {problem && (
            <p
              role="alert"
              className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
            >
              {problem}
            </p>
          )}
          <div className="flex gap-2">
            <button type="submit" className={PRIMARY_BUTTON} disabled={!ready || busy}>
              {busy ? "Adding…" : "Add person"}
            </button>
            <button type="button" className={BUTTON} onClick={onClose} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </DetailSheet>
  );
}
