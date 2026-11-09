"use client";

import { Download, Mail, Plus, Send, UserCheck, UserMinus } from "lucide-react";
import { useEffect, useState } from "react";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { BUTTON, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { WorkerAvatar } from "@/components/workers/WorkerAvatar";
import { api, ApiError } from "@/lib/api";
import type {
  LeadCandidate,
  Leadership,
  ProjectEmailKind,
  ProjectEmailPreview,
} from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";

type Props = {
  code: string;
  canForecast: boolean;
  canPeople: boolean;
};

const messageOf = (e: unknown) =>
  e instanceof ApiError ? e.message : "Something went wrong. Try again.";

const KIND_LABEL: Record<ProjectEmailKind, string> = {
  staff: "the people list",
  recruitment: "the recruitment list",
};

/**
 * Who leads the project and which key roles it needs, with the Excel lists and the one-click
 * emails to the lead. Every number and date comes from the API; this screen only shows them.
 */
export function ProjectLeadership({ code, canForecast, canPeople }: Props) {
  const view = useLoad(() => api.leadership(code), `leadership:${code}`);
  const [sheet, setSheet] = useState<"lead" | ProjectEmailKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, job: () => Promise<string | void>) {
    setBusy(label);
    setProblem(null);
    try {
      const done = await job();
      if (done) setNotice(done);
      view.retry();
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  const data: Leadership | null = view.data;
  const missing = data?.key_roles.filter((r) => r.missing > 0) ?? [];

  return (
    <section
      aria-label="Leadership and key roles"
      className="rounded-card border border-border bg-surface"
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="m-0 text-md font-semibold">Leadership and key roles</h2>
          <p className="m-0 mt-0.5 text-xs text-muted">
            The project lead, the roles a crew this size needs, and the lists to share.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {notice && (
          <p
            role="status"
            className="m-0 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
          >
            {notice}
          </p>
        )}
        {problem && (
          <p
            role="alert"
            className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
          >
            {problem}
          </p>
        )}

        {view.loading ? (
          <SkeletonLoader label="Loading the leadership" variant="rows" count={3} />
        ) : view.error || !data ? (
          <ErrorState title="Couldn’t load the leadership" onRetry={view.retry}>
            {view.error}
          </ErrorState>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {data.lead ? (
                <>
                  <WorkerAvatar code={data.lead.code} name={data.lead.name} />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-xs text-muted">Project lead</p>
                    <p className="m-0 font-semibold">{data.lead.name}</p>
                    <p className="m-0 truncate text-xs text-muted">
                      {data.lead.code} · {data.lead.email ?? "no email address yet"}
                    </p>
                  </div>
                </>
              ) : (
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-xs text-muted">Project lead</p>
                  <p className="m-0 font-semibold">Nobody is assigned yet</p>
                  <p className="m-0 text-xs text-muted">{data.advice}</p>
                </div>
              )}
              {data.can_edit && (
                <div className="flex gap-2">
                  <button type="button" className={PRIMARY_BUTTON} onClick={() => setSheet("lead")}>
                    <UserCheck className="size-4" aria-hidden="true" />
                    {data.lead ? "Change lead" : "Assign lead"}
                  </button>
                  {data.lead && (
                    <button
                      type="button"
                      className={BUTTON}
                      disabled={busy !== null}
                      onClick={() =>
                        run("clear", async () => {
                          await api.clearLead(code);
                          return "The project lead was removed.";
                        })
                      }
                    >
                      <UserMinus className="size-4" aria-hidden="true" />
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="overflow-x-auto rounded-control border border-border">
              <table className="w-full min-w-max border-collapse text-sm">
                <caption className="sr-only">Key roles for a crew of {data.crew} people</caption>
                <thead>
                  <tr className="bg-sunken text-left text-xs text-muted">
                    {["Role", "Needed", "In the plan", "Free now", ""].map((h) => (
                      <th key={h || "state"} scope="col" className="px-3 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.key_roles.map((r) => (
                    <tr key={r.trade} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{r.trade}</td>
                      <td className="px-3 py-2 tabular-nums">{r.recommended}</td>
                      <td className="px-3 py-2 tabular-nums">{r.planned}</td>
                      <td className="px-3 py-2 tabular-nums">{r.people_free}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.missing > 0 ? (
                          <span className="text-warning-text">Add {r.missing}</span>
                        ) : (
                          <span className="text-success-text">Covered</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 text-xs text-muted">
              {data.crew === 0
                ? "Add the project's crew first; the key roles are worked out from its size."
                : `Worked out from a crew of ${data.crew} people. Counts come from the project's own rules, not an AI.`}
            </p>

            <div className="flex flex-wrap gap-2">
              {data.can_edit && missing.length > 0 && (
                <button
                  type="button"
                  className={BUTTON}
                  disabled={busy !== null}
                  onClick={() =>
                    run("roles", async () => {
                      const added = await api.addKeyRoles(code);
                      return added.added.length
                        ? `Added to the plan: ${added.added.join(", ")}.`
                        : "Nothing to add.";
                    })
                  }
                >
                  <Plus className="size-4" aria-hidden="true" />
                  Add suggested roles to the plan
                </button>
              )}
              {canPeople && (
                <a className={BUTTON} href={api.staffXlsxUrl(code)} download>
                  <Download className="size-4" aria-hidden="true" />
                  People (Excel)
                </a>
              )}
              {canForecast && (
                <a className={BUTTON} href={api.recruitmentXlsxUrl(code)} download>
                  <Download className="size-4" aria-hidden="true" />
                  Recruitment (Excel)
                </a>
              )}
              {data.can_edit && canPeople && (
                <button type="button" className={BUTTON} onClick={() => setSheet("staff")}>
                  <Mail className="size-4" aria-hidden="true" />
                  Email people list to the lead
                </button>
              )}
              {data.can_edit && canForecast && (
                <button type="button" className={BUTTON} onClick={() => setSheet("recruitment")}>
                  <Mail className="size-4" aria-hidden="true" />
                  Email recruitment list
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <LeadSheet
        open={sheet === "lead"}
        data={data}
        busy={busy !== null}
        onClose={() => setSheet(null)}
        onAssign={(c) =>
          run("lead", async () => {
            await api.assignLead(code, c.code);
            setSheet(null);
            return `${c.name} now leads ${code}.`;
          })
        }
      />
      <EmailSheet
        code={code}
        kind={sheet === "staff" || sheet === "recruitment" ? sheet : null}
        onClose={() => setSheet(null)}
        onSent={(to) => {
          setSheet(null);
          setNotice(`Email sent to ${to}.`);
        }}
      />
    </section>
  );
}

function LeadSheet({
  open,
  data,
  busy,
  onClose,
  onAssign,
}: {
  open: boolean;
  data: Leadership | null;
  busy: boolean;
  onClose: () => void;
  onAssign: (c: LeadCandidate) => void;
}) {
  return (
    <DetailSheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Choose the project lead"
      meta="A project manager leads one project at a time"
    >
      {data && (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm text-muted">{data.advice}</p>
          <section aria-label="Free to lead" className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold">Free for the whole project</h3>
            {data.free.length === 0 ? (
              <p className="m-0 text-sm text-muted">Nobody is free for these dates.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {data.free.map((c) => (
                  <li
                    key={c.code}
                    className="flex items-center gap-3 rounded-control border border-border px-3 py-2"
                  >
                    <WorkerAvatar code={c.code} name={c.name} className="size-9 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{c.name}</span>
                      <span className="block text-xs text-muted">
                        {c.code}
                        {c.level ? ` · level ${c.level}` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      className={PRIMARY_BUTTON}
                      disabled={busy}
                      onClick={() => onAssign(c)}
                    >
                      Assign
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {data.busy.length > 0 && (
            <section aria-label="Busy" className="flex flex-col gap-2">
              <h3 className="m-0 text-sm font-semibold">Already leading a project</h3>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {data.busy.map((c) => (
                  <li
                    key={c.code}
                    className="flex items-center gap-3 rounded-control border border-border bg-sunken px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{c.name}</span>
                      <span className="block text-xs text-muted">
                        Leads {c.busy_on}
                        {c.busy_until ? `, finishes ${formatDate(c.busy_until)}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </DetailSheet>
  );
}

function EmailSheet({
  code,
  kind,
  onClose,
  onSent,
}: {
  code: string;
  kind: ProjectEmailKind | null;
  onClose: () => void;
  onSent: (to: string) => void;
}) {
  const [preview, setPreview] = useState<ProjectEmailPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!kind) return;
    let stopped = false;
    api
      .previewProjectEmail(code, kind)
      .then((p) => !stopped && (setPreview(p), setProblem(null)))
      .catch((e: unknown) => !stopped && (setPreview(null), setProblem(messageOf(e))));
    return () => {
      stopped = true;
      setPreview(null);
      setProblem(null);
    };
  }, [code, kind]);

  async function send() {
    if (!kind) return;
    setSending(true);
    setProblem(null);
    try {
      const sent = await api.sendProjectEmail(code, kind);
      onSent(sent.to);
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <DetailSheet
      open={kind !== null}
      onOpenChange={(o) => !o && onClose()}
      title={kind ? `Email ${KIND_LABEL[kind]} to the lead` : "Email"}
      meta="You see exactly what will be sent"
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={!preview || sending}
            onClick={send}
          >
            <Send className="size-4" aria-hidden="true" />
            {sending ? "Sending…" : "Send email"}
          </button>
          <button type="button" className={BUTTON} onClick={onClose} disabled={sending}>
            Cancel
          </button>
        </div>
      }
    >
      <div aria-live="polite" className="flex flex-col gap-3">
        {!preview && !problem && (
          <SkeletonLoader label="Preparing the email" variant="lines" count={4} />
        )}
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
              To{" "}
              <b className="text-fg">
                {preview.to_name} ({preview.to})
              </b>
            </p>
            <p className="mt-1 mb-2 font-semibold">{preview.subject}</p>
            <pre className="m-0 font-sans text-sm whitespace-pre-wrap">{preview.body}</pre>
            <p className="mt-3 mb-0 inline-flex items-center gap-1.5 rounded-control border border-border-strong bg-surface px-2 py-1 text-xs">
              <Download className="size-3.5" aria-hidden="true" />
              {preview.attachment}
            </p>
          </article>
        )}
      </div>
    </DetailSheet>
  );
}
