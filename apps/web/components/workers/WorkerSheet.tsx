"use client";

import { CalendarClock, CircleAlert, Phone, UserX } from "lucide-react";
import { useState } from "react";
import { SlidingTabs } from "@/components/motion/SlidingTabs";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { StatusChip } from "@/components/ui/StatusChip";
import type { WorkerDetail } from "@/lib/api-types";
import { DOCUMENT_NAME, NUMBER_NAME, timeLeft } from "@/lib/documents";
import { formatDate } from "@/lib/format";
import { RevealNumber } from "./RevealNumber";
import { useWorkerDetail } from "./useWorkers";
import { WorkerStatusChip } from "./WorkerStatusChip";

type TabId = "overview" | "documents" | "assignments";

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
                key={`${risk.kind}:${risk.document_type}:${risk.project_code ?? ""}`}
                className="flex items-start gap-2 rounded-control border border-border bg-sunken p-3 text-sm"
              >
                <StatusChip
                  tone={risk.severity === "critical" ? "danger" : "warning"}
                  icon={risk.severity === "critical" ? CircleAlert : CalendarClock}
                  label={risk.severity === "critical" ? "Expired" : "Ends early"}
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

function Documents({ worker }: { worker: WorkerDetail }) {
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
        </li>
      ))}
    </ul>
  );
}

function Profile({ worker }: { worker: WorkerDetail }) {
  const [tab, setTab] = useState<TabId>("overview");
  const full = worker.status !== null; // the narrow projection has nothing but the overview
  return (
    <>
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
      {tab === "documents" && <Documents worker={worker} />}
      {tab === "assignments" && <Assignments worker={worker} />}
    </>
  );
}

type Props = {
  /** The worker to show; null closes the sheet. */
  code: string | null;
  /** Their name from the list, so the title is right while the profile loads. */
  fallbackName?: string;
  onClose: () => void;
};

export function WorkerSheet({ code, fallbackName, onClose }: Props) {
  const { worker, error, loading, retry } = useWorkerDetail(code);
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
      {worker && <Profile key={worker.code} worker={worker} />}
    </DetailSheet>
  );
}
