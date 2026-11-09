"use client";

import {
  ArrowRightLeft,
  CalendarClock,
  CircleAlert,
  Mail,
  Pencil,
  Phone,
  UserX,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { SlidingTabs } from "@/components/motion/SlidingTabs";
import { BUTTON, FIELD, PRIMARY_BUTTON, SMALL_BUTTON } from "@/components/ui/button-styles";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip } from "@/components/ui/StatusChip";
import { api, ApiError } from "@/lib/api";
import type { WorkerDetail, WorkerRisk } from "@/lib/api-types";
import { DOCUMENT_NAME, NUMBER_NAME, timeLeft } from "@/lib/documents";
import { formatDate } from "@/lib/format";
import { EditWorker } from "./EditWorker";
import { EmailWorker } from "./EmailWorker";
import { RevealNumber } from "./RevealNumber";
import { useWorkerDetail } from "./useWorkers";
import { WorkerStatusChip } from "./WorkerStatusChip";

export type TabId = "overview" | "documents" | "assignments";

const EXIT_REASON: Record<string, string> = {
  resigned: "Resigned",
  terminated: "Terminated",
  absconded: "Left without notice",
  contract_ended: "Contract ended",
  other: "Other",
};

/** The chip beside each "Needs attention" line: what kind of problem it is. */
const RISK_LABEL: Record<WorkerRisk["kind"], Record<WorkerRisk["severity"], string>> = {
  expired: { critical: "Expired", warning: "Expired" },
  ends_before_assignment: { critical: "Ends early", warning: "Ends early" },
  contract_ends: { critical: "Contract ended", warning: "Contract ends early" },
  leaving: { critical: "Left", warning: "Leaving" },
  absconded: { critical: "Left without notice", warning: "Left without notice" },
};

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 text-sm last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function Overview({ worker }: { worker: WorkerDetail }) {
  return (
    <>
      {worker.risks.length > 0 && (
        <section aria-labelledby="risks-title" className="flex flex-col gap-2">
          <h3 id="risks-title" className="text-sm font-semibold">
            Needs attention
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {worker.risks.map((risk) => (
              <li
                key={`${risk.kind}:${risk.document_type ?? ""}:${risk.project_code ?? ""}`}
                className="flex items-start gap-2 rounded-control border border-border bg-sunken p-3 text-sm"
              >
                <StatusChip
                  tone={risk.severity === "critical" ? "danger" : "warning"}
                  icon={risk.severity === "critical" ? CircleAlert : CalendarClock}
                  label={RISK_LABEL[risk.kind][risk.severity]}
                  className="shrink-0"
                />
                <span>{risk.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <dl className="m-0">
        <Fact label="Trade">{worker.trade}</Fact>
        <Fact label="Skill level">{worker.level ? `${worker.level} of 5` : "Not recorded"}</Fact>
        <Fact label="Status">{worker.status && <WorkerStatusChip status={worker.status} />}</Fact>
        <Fact label="Project">
          {worker.project ? (
            <span className="font-mono text-xs">{worker.project}</span>
          ) : (
            <span className="text-subtle">None</span>
          )}
        </Fact>
        {worker.contract_end_on && (
          <Fact label="Contract ends">{formatDate(worker.contract_end_on)}</Fact>
        )}
        {worker.exit_on && (
          <Fact label={worker.exit_reason === "absconded" ? "Left on" : "Leaving on"}>
            {formatDate(worker.exit_on)}
            {worker.exit_reason && (
              <span className="ml-2 text-xs font-normal text-muted">
                {EXIT_REASON[worker.exit_reason] ?? worker.exit_reason}
              </span>
            )}
          </Fact>
        )}
        <Fact label="Phone">
          {worker.phone ? (
            <a
              href={`tel:${worker.phone.replace(/\s+/g, "")}`}
              className="inline-flex items-center gap-1.5 text-accent-text hover:underline"
            >
              <Phone className="size-3.5" aria-hidden="true" />
              {worker.phone}
            </a>
          ) : (
            <span className="text-subtle">Not recorded</span>
          )}
        </Fact>
      </dl>
    </>
  );
}

/** HR corrects when a document runs out: one date field and Save, no dialog. */
function ExpiryEditor({
  worker,
  type,
  current,
  onChanged,
}: {
  worker: WorkerDetail;
  type: string;
  current: string | null;
  onChanged: (notice: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = DOCUMENT_NAME[type] ?? type;
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${SMALL_BUTTON} mt-2`}>
        <Pencil className="size-3.5" aria-hidden="true" />
        Change date
      </button>
    );
  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        try {
          await api.editDocumentExpiry(worker.code, type, value);
          setOpen(false);
          onChanged(`${name} now runs out on ${formatDate(value)}.`);
        } catch (e) {
          setError(e instanceof ApiError ? e.message : "Couldn’t save. Try again.");
        } finally {
          setSaving(false);
        }
      }}
    >
      <label className="text-xs font-medium text-muted" htmlFor={`exp-${type}`}>
        {name} expires on
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`exp-${type}`}
          type="date"
          required
          className={FIELD}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="submit"
          className={PRIMARY_BUTTON}
          disabled={saving || !value || value === current}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" className={BUTTON} onClick={() => setOpen(false)} disabled={saving}>
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </form>
  );
}

function Documents({
  worker,
  canEdit,
  onChanged,
}: {
  worker: WorkerDetail;
  canEdit: boolean;
  onChanged: (notice: string) => void;
}) {
  if (worker.documents.length === 0)
    return (
      <EmptyState icon={UserX} title="No documents on file">
        Documents appear here once they are uploaded.
      </EmptyState>
    );
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {worker.documents.map((doc) => {
        const name = DOCUMENT_NAME[doc.type] ?? doc.type;
        const left = doc.days_left === null ? null : timeLeft(doc.days_left);
        return (
          <li key={doc.type} className="rounded-card border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{name}</h3>
              {left && (
                <StatusChip
                  tone={left.tone}
                  icon={left.tone === "danger" ? CircleAlert : CalendarClock}
                  label={left.label}
                />
              )}
            </div>
            <dl className="mt-2 mb-0">
              <Fact label="Expires">{doc.expiry ? formatDate(doc.expiry) : "No expiry"}</Fact>
              {doc.number && (
                <Fact label={NUMBER_NAME[doc.type] ?? "Number"}>
                  <RevealNumber
                    workerCode={worker.code}
                    documentType={doc.type}
                    label={NUMBER_NAME[doc.type] ?? "Number"}
                    masked={doc.number}
                    canReveal={doc.can_reveal}
                  />
                </Fact>
              )}
            </dl>
            {canEdit && doc.expiry && (
              <ExpiryEditor
                worker={worker}
                type={doc.type}
                current={doc.expiry}
                onChanged={onChanged}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Assignments({ worker }: { worker: WorkerDetail }) {
  if (worker.assignments.length === 0)
    return (
      <EmptyState icon={UserX} title="No projects yet">
        {worker.name} has not been allocated to a project.
      </EmptyState>
    );
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {worker.assignments.map((a) => (
        <li
          key={`${a.project_code}:${a.starts}`}
          className="rounded-card border border-border p-3 text-sm"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">
              <span className="font-mono text-xs text-subtle">{a.project_code}</span>{" "}
              {a.project_name}
            </span>
            <span className="text-xs text-muted capitalize">{a.status}</span>
          </div>
          <p className="mt-1 mb-0 text-xs text-muted">
            {formatDate(a.starts)} to {a.ends ? formatDate(a.ends) : "no end date"}
          </p>
          {a.moving_from && (
            <p className="mt-1 mb-0 flex items-center gap-1.5 text-xs text-info-text">
              <ArrowRightLeft className="size-3.5" aria-hidden="true" />
              Moving from {a.moving_from}
              {a.moving_from_ends ? `, last day there ${formatDate(a.moving_from_ends)}` : ""}
            </p>
          )}
          {a.mobilization && (
            <p className="mt-1 mb-0 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <Link
                href={`/mobilization?mob=${encodeURIComponent(a.mobilization.mob_no)}`}
                className="font-mono underline-offset-2 hover:underline"
              >
                {a.mobilization.mob_no}
              </Link>
              <span>
                {a.mobilization.tasks_done} of {a.mobilization.tasks_total} tasks done
                {a.mobilization.stage === "on_site" ? ", arrived" : ""}
              </span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function Profile({
  worker,
  initialTab,
  canEdit,
  onChanged,
}: {
  worker: WorkerDetail;
  initialTab: TabId;
  canEdit: boolean;
  onChanged: (notice: string) => void;
}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [editing, setEditing] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const full = worker.status !== null; // the narrow projection has nothing but the overview
  if (emailing)
    return (
      <EmailWorker
        worker={worker}
        onCancel={() => setEmailing(false)}
        onDone={(notice) => {
          setEmailing(false);
          onChanged(notice);
        }}
      />
    );
  if (editing)
    return (
      <EditWorker
        worker={worker}
        onCancel={() => setEditing(false)}
        onSaved={(_fresh, notice) => {
          setEditing(false);
          onChanged(notice);
        }}
      />
    );
  return (
    <>
      {canEdit && full && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setEditing(true)} className={BUTTON}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit details
          </button>
          <button type="button" onClick={() => setEmailing(true)} className={BUTTON}>
            <Mail className="size-4" aria-hidden="true" />
            Email worker
          </button>
        </div>
      )}
      {full && (
        <SlidingTabs
          label="Worker details"
          value={tab}
          onChange={(id) => setTab(id as TabId)}
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "documents", label: "Documents", count: worker.documents.length },
            { id: "assignments", label: "Projects", count: worker.assignments.length },
          ]}
        />
      )}
      {tab === "overview" && <Overview worker={worker} />}
      {tab === "documents" && <Documents worker={worker} canEdit={canEdit} onChanged={onChanged} />}
      {tab === "assignments" && <Assignments worker={worker} />}
    </>
  );
}

type Props = {
  /** The worker to show; null closes the sheet. */
  code: string | null;
  /** Their name from the list, so the title is right while the profile loads. */
  fallbackName?: string;
  /** Which tab to open on (the Documents screen opens on Documents). */
  initialTab?: TabId;
  onClose: () => void;
};

export function WorkerSheet({ code, fallbackName, initialTab = "overview", onClose }: Props) {
  const { worker, error, loading, retry } = useWorkerDetail(code);
  const canEdit = useUser().permissions.includes("employee:write");
  // The message belongs to the worker it was about, so it never shows on someone else.
  const [saved, setSaved] = useState<{ code: string; text: string } | null>(null);
  const notice = saved && saved.code === code ? saved.text : null;
  return (
    <DetailSheet
      open={code !== null}
      onOpenChange={(open) => !open && onClose()}
      title={worker?.name ?? fallbackName ?? "Worker"}
      meta={
        code && (
          <>
            <span className="font-mono">{code}</span>
            {worker && <span>{worker.trade}</span>}
          </>
        )
      }
    >
      {loading && <SkeletonLoader label="Loading worker" variant="lines" count={5} />}
      {error?.status === 404 && (
        <EmptyState icon={UserX} title="Worker not found">
          This person is not in your list, or was removed.
        </EmptyState>
      )}
      {error && error.status !== 404 && (
        <ErrorState title="Couldn’t load" onRetry={retry}>
          {error.message}
        </ErrorState>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-control bg-success-soft px-3 py-2 text-sm text-success-text"
        >
          {notice}
        </p>
      )}
      {worker && (
        <Profile
          key={worker.code}
          worker={worker}
          initialTab={initialTab}
          canEdit={canEdit}
          onChanged={(text) => {
            setSaved({ code: worker.code, text });
            retry();
          }}
        />
      )}
    </DetailSheet>
  );
}
