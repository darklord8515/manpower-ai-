"use client";

import { CalendarClock, Check, FlaskConical, Send, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip } from "@/components/ui/StatusChip";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { initialsOf } from "@/components/workers/WorkerAvatar";
import { api, ApiError } from "@/lib/api";
import type { ApplicantDetail, InterviewBody, InterviewPreview } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { STATUS_LABEL, TIER } from "./ApplicantsScreen";

const messageOf = (e: unknown) =>
  e instanceof ApiError ? e.message : "Something went wrong. Try again.";

type Props = {
  code: string | null;
  onClose: () => void;
  /** Something changed (a status or an invitation), so the list should look again. */
  onChanged: () => void;
};

export function ApplicantSheet({ code, onClose, onChanged }: Props) {
  const view = useLoad(() => api.applicant(code ?? ""), `applicant:${code}`, code !== null);
  const [notice, setNotice] = useState<string | null>(null);
  const a = view.data;
  return (
    <DetailSheet
      open={code !== null}
      onOpenChange={(open) => !open && onClose()}
      title={a?.name ?? "Applicant"}
      meta={
        a && (
          <>
            <span className="font-mono">{a.code}</span>
            <span>{a.category}</span>
            <StatusChip tone="warning" icon={FlaskConical} label="Demo data" />
          </>
        )
      }
    >
      {notice && (
        <p
          role="status"
          className="m-0 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
        >
          {notice}
        </p>
      )}
      {view.loading && !a ? (
        <SkeletonLoader label="Loading the applicant" variant="lines" count={6} />
      ) : view.error ? (
        <ErrorState title="Couldn’t load the applicant" onRetry={view.retry}>
          {view.error}
        </ErrorState>
      ) : a ? (
        <Body
          key={a.code}
          a={a}
          onNotice={(text) => {
            setNotice(text);
            view.retry();
            onChanged();
          }}
        />
      ) : null}
    </DetailSheet>
  );
}

function Body({ a, onNotice }: { a: ApplicantDetail; onNotice: (text: string) => void }) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function setStatus(status: "new" | "shortlisted" | "rejected", text: string) {
    setBusy(true);
    setProblem(null);
    try {
      await api.setApplicantStatus(a.code, status);
      onNotice(text);
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-sunken text-base font-semibold text-muted">
          {initialsOf(a.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 font-semibold">{a.category}</p>
          <p className="m-0 text-xs text-muted">
            {a.years} {a.years === 1 ? "year" : "years"} of experience
            {a.nationality ? ` · ${a.nationality}` : ""}
            {a.location ? ` · ${a.location}` : ""}
          </p>
          <p className="m-0 text-xs text-muted">{STATUS_LABEL[a.status]}</p>
        </div>
        <div className="text-right">
          <p className="m-0 text-2xl font-semibold tabular-nums">{a.percent}%</p>
          <StatusChip tone={TIER[a.tier].tone} icon={Sparkles} label={TIER[a.tier].label} />
        </div>
      </div>

      {a.summary && <p className="m-0 text-sm text-muted">{a.summary}</p>}

      <section aria-label="Why this match" className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold">Why {a.percent}%</h3>
        <ul className="m-0 list-disc pl-5 text-sm">
          {a.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1.5">
          {a.matched.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs text-success-text"
            >
              <Check className="size-3" aria-hidden="true" />
              {s}
            </span>
          ))}
          {a.missing.map((s) => (
            <span
              key={s}
              className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning-text"
            >
              <X className="size-3" aria-hidden="true" />
              {s}
            </span>
          ))}
        </div>
        <p className="m-0 text-xs text-muted">
          The percentage is worked out by the hiring rules (skills, experience, documents,
          availability), not by an AI. This page uses demo data.
        </p>
      </section>

      <dl className="m-0 text-sm">
        {[
          ["Documents", a.documents_ready ? "Ready" : "Not ready yet"],
          ["Can start", a.available_from ? formatDate(a.available_from) : "Not set"],
          ["Email", a.email ?? "Not set"],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-b-0"
          >
            <dt className="text-muted">{label}</dt>
            <dd className="m-0 text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      {problem && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {problem}
        </p>
      )}

      {a.can_invite && (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={busy || a.status === "shortlisted"}
              onClick={() => void setStatus("shortlisted", `${a.name} was shortlisted.`)}
            >
              Shortlist
            </button>
            <button
              type="button"
              className={BUTTON}
              disabled={busy || a.status === "rejected"}
              onClick={() => void setStatus("rejected", `${a.name} was marked as not selected.`)}
            >
              Not selected
            </button>
          </div>
          <InterviewForm a={a} onSent={onNotice} />
        </>
      )}

      {a.interviews.length > 0 && (
        <section aria-label="Invitations sent" className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold">Invitations</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {a.interviews.map((i) => (
              <li
                key={i.starts_at + i.sent_to}
                className="rounded-control border border-border px-3 py-2 text-sm"
              >
                <span className="font-medium">
                  {new Date(i.starts_at).toLocaleString("en-GB", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Dubai",
                  })}
                </span>{" "}
                · {i.mode === "online" ? "Online" : "In person"} · sent to {i.sent_to}
                {i.delivered ? "" : " (not delivered)"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function InterviewForm({ a, onSent }: { a: ApplicantDetail; onSent: (text: string) => void }) {
  const [day, setDay] = useState("");
  const [at, setAt] = useState("10:00");
  const [mode, setMode] = useState<"online" | "offline">("online");
  const [venue, setVenue] = useState("");
  const [note, setNote] = useState("");
  const [sendTo, setSendTo] = useState(a.email ?? "");
  const [preview, setPreview] = useState<InterviewPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "send" | null>(null);

  const body: InterviewBody = {
    day,
    at,
    mode,
    venue,
    note: note.trim() || null,
    send_to: sendTo.trim() || null,
  };
  const complete = day !== "" && at !== "" && venue.trim().length >= 3;

  async function show() {
    setBusy("preview");
    setProblem(null);
    try {
      setPreview(await api.previewInterview(a.code, body));
    } catch (e) {
      setPreview(null);
      setProblem(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy("send");
    setProblem(null);
    try {
      const sent = await api.inviteApplicant(a.code, body);
      setPreview(null);
      onSent(`Invitation sent to ${sent.to}.`);
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Invite to an interview" className="flex flex-col gap-3">
      <h3 className="m-0 flex items-center gap-2 text-sm font-semibold">
        <CalendarClock className="size-4" aria-hidden="true" />
        Invite to an interview
      </h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Date
          <input
            type="date"
            className={FIELD}
            value={day}
            onChange={(e) => (setDay(e.target.value), setPreview(null))}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Time (UAE)
          <input
            type="time"
            className={FIELD}
            value={at}
            onChange={(e) => (setAt(e.target.value), setPreview(null))}
          />
        </label>
      </div>
      <fieldset className="m-0 flex gap-2 border-0 p-0">
        <legend className="mb-1 text-xs font-medium text-muted">How</legend>
        {(
          [
            ["online", "Online"],
            ["offline", "In person"],
          ] as const
        ).map(([id, label]) => (
          <label
            key={id}
            className="flex cursor-pointer items-center gap-2 rounded-control border border-border-strong px-3 py-1.5 text-sm has-checked:bg-hover has-checked:font-medium"
          >
            <input
              type="radio"
              name={`mode-${a.code}`}
              checked={mode === id}
              onChange={() => (setMode(id), setPreview(null))}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        {mode === "online" ? "Meeting link" : "Address"}
        <input
          className={FIELD}
          value={venue}
          placeholder={
            mode === "online" ? "https://meet.example.com/…" : "HR office, Ras Al Khaimah"
          }
          onChange={(e) => (setVenue(e.target.value), setPreview(null))}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Note for the applicant (optional)
        <textarea
          rows={2}
          maxLength={600}
          className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm"
          value={note}
          onChange={(e) => (setNote(e.target.value), setPreview(null))}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted">
        Send to
        <input
          type="email"
          className={FIELD}
          value={sendTo}
          onChange={(e) => (setSendTo(e.target.value), setPreview(null))}
        />
      </label>

      {problem && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {problem}
        </p>
      )}
      {preview && (
        <article className="rounded-card border border-border bg-sunken p-3 text-sm">
          <p className="m-0 text-xs text-muted">
            To <b className="text-fg">{preview.to}</b>
          </p>
          <p className="mt-1 mb-2 font-semibold">{preview.subject}</p>
          <pre className="m-0 font-sans text-sm whitespace-pre-wrap">{preview.body}</pre>
        </article>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className={BUTTON}
          disabled={!complete || busy !== null}
          onClick={() => void show()}
        >
          {busy === "preview" ? "Preparing…" : "Preview message"}
        </button>
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={!preview || busy !== null}
          onClick={() => void send()}
        >
          <Send className="size-4" aria-hidden="true" />
          {busy === "send" ? "Sending…" : "Send invitation"}
        </button>
      </div>
    </section>
  );
}
