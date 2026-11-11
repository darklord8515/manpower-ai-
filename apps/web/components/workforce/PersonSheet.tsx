"use client";

import { Bot, Check, UserX } from "lucide-react";
import { useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { api, ApiError } from "@/lib/api";
import type { WOverfilled, WPersonDetail } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useLoad } from "@/lib/use-load";
import { cn } from "@/lib/utils";
import { OverfilledPanel } from "./OverfilledPanel";
import { messageOf, STEPS, StatusPill } from "./shared";

type Props = { code: string | null; onClose: () => void; onChanged: () => void };

const KIND: Record<string, string> = {
  added: "Added",
  placed: "Placed on a project",
  moved: "Moved",
  documents_cleared: "Documents cleared",
  joined: "Joined",
  resigned: "Resigned",
  plan_changed: "Plan changed",
  imported: "Imported",
};

/** One person: where they are, the path Offer issued -> Documents cleared -> Joined, and their history. */
export function PersonSheet({ code, onClose, onChanged }: Props) {
  const view = useLoad(() => api.wPerson(code ?? ""), `w-person:${code}`, code !== null);
  const [notice, setNotice] = useState<string | null>(null);
  const p = view.data;
  return (
    <DetailSheet
      open={code !== null}
      onOpenChange={(open) => {
        if (!open) {
          setNotice(null);
          onClose();
        }
      }}
      title={p?.name ?? "Person"}
      meta={
        p && (
          <>
            <span className="font-mono">{p.code}</span>
            <span>{p.designation}</span>
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
      {view.loading && !p ? (
        <SkeletonLoader label="Loading the person" variant="lines" count={6} />
      ) : view.error?.startsWith("Person not found") ? (
        <EmptyState icon={UserX} title="Person not found">
          They are not in your list, or were removed.
        </EmptyState>
      ) : view.error ? (
        <ErrorState title="Couldn’t load" onRetry={view.retry}>
          {view.error}
        </ErrorState>
      ) : p ? (
        <Body
          key={p.code}
          p={p}
          onDone={(text) => {
            setNotice(text);
            view.retry();
            onChanged();
          }}
        />
      ) : null}
    </DetailSheet>
  );
}

function Body({ p, onDone }: { p: WPersonDetail; onDone: (text: string) => void }) {
  const canWrite = useUser().permissions.includes("employee:write");
  const projects = useLoad(() => api.wProjects(), "w-projects");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [resignOn, setResignOn] = useState("");
  const [ask, setAsk] = useState<{ detail: string; data: WOverfilled } | null>(null);
  const left = ["resigned", "terminated", "absconded"].includes(p.status);
  const reached = STEPS.findIndex((s) => s.status === p.status);

  async function run(job: () => Promise<string>) {
    setBusy(true);
    setProblem(null);
    try {
      onDone(await job());
      setAsk(null);
    } catch (e) {
      if (e instanceof ApiError && e.overfilled) setAsk({ detail: e.message, data: e.overfilled });
      else setProblem(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  const move = (resolve?: "increase_plan") =>
    run(async () => (await api.wMove(p.code, target, resolve)).message);

  if (ask)
    return (
      <OverfilledPanel
        detail={ask.detail}
        ask={ask.data}
        busy={busy}
        onRaise={() => void move("increase_plan")}
        onCancel={() => setAsk(null)}
        onFreed={(text) => {
          setAsk(null);
          onDone(text);
        }}
      />
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={p.status} />
        <span className="text-sm text-muted">
          {p.project_name ? `On ${p.project_name}` : "Not placed on a project"}
          {p.discipline ? ` · ${p.discipline}` : ""}
          {p.uae_national ? " · UAE national" : ""}
        </span>
      </div>

      {!left && (
        <ol aria-label="Mobilization" className="m-0 flex list-none gap-2 p-0">
          {STEPS.map((s, i) => (
            <li
              key={s.status}
              aria-current={i === reached ? "step" : undefined}
              className={cn(
                "flex flex-1 items-center gap-2 rounded-control border px-3 py-2 text-sm",
                i <= reached
                  ? "border-border-strong bg-hover font-medium"
                  : "border-border text-muted",
              )}
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-sunken text-xs">
                {i < reached || (i === reached && p.status === "active") ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : (
                  i + 1
                )}
              </span>
              {s.label}
            </li>
          ))}
        </ol>
      )}

      {problem && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {problem}
        </p>
      )}

      {canWrite && !left && (
        <div className="flex flex-col gap-3">
          {p.next_step && (
            <div>
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const to = p.next_step as "documents_cleared" | "active";
                    await api.wMilestone(p.code, to);
                    return to === "active"
                      ? `${p.name} has joined.`
                      : `${p.name}’s documents are cleared.`;
                  })
                }
              >
                {p.next_step === "active" ? "Mark as joined" : "Mark documents cleared"}
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Move to another project
              <select className={FIELD} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Choose a project…</option>
                {(projects.data ?? [])
                  .filter((x) => x.code !== p.project_code)
                  .map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.name}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className={BUTTON}
              disabled={!target || busy}
              onClick={() => void move()}
            >
              Move
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted">
              Last day (optional)
              <input
                type="date"
                className={FIELD}
                value={resignOn}
                onChange={(e) => setResignOn(e.target.value)}
              />
            </label>
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api.wMilestone(p.code, "resigned", resignOn || undefined);
                  return `${p.name} was marked as resigned.`;
                })
              }
            >
              Resign
            </button>
          </div>
        </div>
      )}

      <dl className="m-0 text-sm">
        {[
          ["Joined on", p.joined_on ? formatDate(p.joined_on) : "Not yet"],
          ...(p.exit_on ? [["Left on", formatDate(p.exit_on)]] : []),
          [
            "Recruited",
            p.source === "overseas" ? "Overseas" : p.source === "local" ? "Locally" : "Not set",
          ],
          ...(p.phone ? [["Phone", p.phone]] : []),
          ...(p.email ? [["Email", p.email]] : []),
          ...(p.note ? [["Note", p.note]] : []),
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

      <section aria-label="History" className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold">History</h3>
        {p.history.length === 0 ? (
          <p className="m-0 text-sm text-muted">Nothing has been recorded yet.</p>
        ) : (
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {p.history.map((h, i) => (
              <li
                key={`${i}:${h.at}:${h.kind}`}
                className="rounded-control border border-border px-3 py-2 text-sm"
              >
                <p className="m-0 flex flex-wrap items-center gap-2 font-medium">
                  {KIND[h.kind] ?? h.kind}
                  {h.decided_by === "ai" && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-xs text-info-text">
                      <Bot className="size-3" aria-hidden="true" />
                      AI
                    </span>
                  )}
                  <span className="ml-auto text-xs font-normal text-muted">
                    {formatDate(h.at.slice(0, 10))}
                  </span>
                </p>
                {(h.to_project || h.from_project) && (
                  <p className="m-0 text-xs text-muted">
                    {h.from_project ? `${h.from_project} → ` : ""}
                    {h.to_project ?? ""}
                  </p>
                )}
                {h.reason && <p className="m-0 mt-1 text-xs">{h.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
