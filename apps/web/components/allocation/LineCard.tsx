"use client";

import { Bot, CircleCheck, CircleX, Sparkles, TriangleAlert, UserMinus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { BoardExcluded, LineRow, Violation } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AgentPanel } from "./AgentPanel";
import { PickList } from "./PickList";
import { plural } from "./parts";

type Props = {
  requestNo: string;
  line: LineRow;
  /** False once the whole request is closed (filled, rejected, cancelled). */
  requestOpen: boolean;
  canPrepare: boolean;
  /** Whether the MOB numbers of approved workers link to their checklists. */
  canOpenMobilization?: boolean;
  canApprove: boolean;
  /** Why this person cannot approve, when they cannot. */
  approveNote: string | null;
  active: boolean;
  onActivate: () => void;
  /** Who the rules left out; only known for the line the pool is showing. */
  excluded: BoardExcluded[] | null;
  swapping: string | null;
  onSwap: (code: string | null) => void;
  /** Something changed on the server: reload the request and say what happened. */
  onChanged: (notice: string) => void;
  onApprove: () => void;
  /**
   * The Workforce agent button. Absent when the person may not use AI; `available` false shows it
   * switched off, with `reason` beside it.
   */
  agent?: { available: boolean; reason: string | null };
};

const MIN_REJECT = 10;
const MIN_REMOVE = 3;

function ExcludedCallout({ people }: { people: BoardExcluded[] }) {
  return (
    <details open className="rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-text">
      <summary className="flex cursor-pointer items-center gap-2 font-medium">
        <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
        Left out by the rules ({people.length})
      </summary>
      <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
        {people.map((p) => (
          <li key={p.code}>
            <span className="font-medium">{p.name}</span>{" "}
            <span className="font-mono text-xs">{p.code}</span>: {p.message}{" "}
            <span className="font-mono text-xs opacity-80">{p.rule}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** One trade on a request: who is chosen, what the rules left out, and the line's decisions. */
export function LineCard({
  requestNo,
  line,
  requestOpen,
  canPrepare,
  canOpenMobilization = false,
  canApprove,
  approveNote,
  active,
  onActivate,
  excluded,
  swapping,
  onSwap,
  onChanged,
  onApprove,
  agent,
}: Props) {
  const [asking, setAsking] = useState(0); // goes up each time the agent is asked; 0 = closed
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState<string[] | null>(null);
  const [removeReason, setRemoveReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoreProblems, setRestoreProblems] = useState<Record<string, Violation[]>>({});

  const open = line.status === "open" && requestOpen;
  const editable = open && canPrepare;
  const chosen = line.picks.filter((p) => p.removed_reason === null);
  const openSlots = Math.max(line.headcount - chosen.length, 0);
  const flagged = chosen.filter((p) => p.violations.length > 0);
  const blocker =
    chosen.length === 0
      ? "Choose at least one worker first."
      : flagged.length > 0
        ? "Fix or remove the highlighted workers first."
        : null;

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setError(null);
    try {
      onChanged(await task());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const suggest = () =>
    run(async () => {
      const result = await api.suggestPeople(requestNo, line.id);
      return result.chosen === 0
        ? "No one else is cleared for the open places."
        : `${plural(result.chosen, "worker")} suggested by the rules. Check them, then approve.`;
    });

  const confirmRemove = () =>
    run(async () => {
      const codes = removing ?? [];
      for (const code of codes) await api.removePerson(requestNo, line.id, code, removeReason);
      setRemoving(null);
      setRemoveReason("");
      setSelected(new Set());
      return `Removed ${plural(codes.length, "worker")}.`;
    });

  async function restore(code: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.restorePerson(requestNo, line.id, code);
      const first = result.results[0];
      if (first?.outcome === "refused") {
        setRestoreProblems((p) => ({ ...p, [code]: first.violations }));
      } else {
        setRestoreProblems({});
        onChanged(`${first?.name ?? "The worker"} is back on the line.`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t restore. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const confirmReject = () =>
    run(async () => {
      await api.rejectLine(requestNo, line.id, rejectReason.trim());
      setRejecting(false);
      return `The ${line.trade.toLowerCase()} line was rejected.`;
    });

  function toggle(code: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(code)) next.add(code);
      return next;
    });
  }

  const escape = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    if (removing) setRemoving(null);
    else if (rejecting) setRejecting(false);
    else if (swapping) onSwap(null);
    else if (asking > 0) setAsking(0);
  };

  const startRemoving = (codes: string[]) => {
    setRejecting(false);
    setRemoving(codes);
    setRemoveReason("");
  };
  const removingNames = (removing ?? []).map((c) => chosen.find((p) => p.code === c)?.name ?? c);

  return (
    <section
      aria-label={`${line.trade} line`}
      onKeyDown={escape}
      onFocusCapture={onActivate}
      onPointerDownCapture={onActivate}
      className={cn(
        "flex flex-col gap-3 rounded-card border bg-surface p-4",
        active ? "border-border-strong" : "border-border",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="m-0 text-md font-semibold">
            {line.trade} <span className="text-muted">× {line.headcount}</span>
          </h3>
          <p className="m-0 mt-0.5 text-xs text-muted">
            {line.min_level ? `Level ${line.min_level} or higher · ` : "Any level · "}
            {line.status === "approved"
              ? `${line.filled} of ${line.headcount} approved`
              : line.status === "rejected"
                ? "Rejected"
                : `${chosen.length} of ${line.headcount} selected`}
          </p>
        </div>

        {open && canApprove && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              onClick={() => {
                setRemoving(null);
                setRejecting((r) => !r);
              }}
            >
              <CircleX className="size-4" aria-hidden="true" />
              Reject line
            </button>
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={busy || blocker !== null}
              aria-describedby={blocker ? `${line.id}-blocker` : undefined}
              onClick={onApprove}
            >
              <CircleCheck className="size-4" aria-hidden="true" />
              {chosen.length > 0 ? `Approve ${plural(chosen.length, "worker")}` : "Approve"}
            </button>
          </div>
        )}
      </header>

      {open && canApprove && blocker && (
        <p id={`${line.id}-blocker`} className="m-0 text-xs text-muted">
          {blocker}
        </p>
      )}
      {open && !canApprove && approveNote && (
        <p className="m-0 text-xs text-muted">{approveNote}</p>
      )}

      {error && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {error}
        </p>
      )}

      {line.status === "approved" && (
        <div className="flex flex-col gap-2">
          <p className="m-0 flex items-start gap-2 rounded-control bg-success-soft px-3 py-2 text-sm text-success-text">
            <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Approved by {line.decided_by ?? "the HR Manager"}
              {line.decided_at ? ` on ${formatDate(line.decided_at)}` : ""}.{" "}
              {plural(line.approved.length, "assignment")} planned
              {line.approved.some((a) => a.mob_no) ? ", mobilizations started." : "."}
            </span>
          </p>
          <ul
            aria-label="Approved workers"
            className="m-0 flex list-none flex-col rounded-control border border-border p-0"
          >
            {line.approved.map((a) => (
              <li
                key={a.code}
                className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-border px-3 py-2 text-sm last:border-b-0"
              >
                <span className="font-medium">
                  {a.name}{" "}
                  <span className="font-mono text-xs font-normal text-subtle">{a.code}</span>
                </span>
                <span className="text-xs text-muted">
                  Starts {formatDate(a.starts_on)}
                  {a.moving_from ? `, after ${a.moving_from}` : ""}
                </span>
                {a.mob_no &&
                  (canOpenMobilization ? (
                    <Link
                      href={`/mobilization?mob=${encodeURIComponent(a.mob_no)}`}
                      className="ml-auto font-mono text-xs underline-offset-2 hover:underline"
                    >
                      {a.mob_no}
                    </Link>
                  ) : (
                    <span className="ml-auto font-mono text-xs">{a.mob_no}</span>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {line.status === "rejected" && (
        <p className="m-0 flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text">
          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            Rejected by {line.decided_by ?? "the HR Manager"}
            {line.decided_at ? ` on ${formatDate(line.decided_at)}` : ""}: {line.decision_reason}
          </span>
        </p>
      )}

      {open && rejecting && (
        <form
          aria-label={`Reject the ${line.trade.toLowerCase()} line`}
          className="flex flex-col gap-2 rounded-control border border-border bg-sunken p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmReject();
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            Why is this line rejected?
            <textarea
              autoFocus
              rows={2}
              maxLength={500}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm font-normal"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className={PRIMARY_BUTTON}
              disabled={busy || rejectReason.trim().length < MIN_REJECT}
            >
              Reject line
            </button>
            <button type="button" className={BUTTON} onClick={() => setRejecting(false)}>
              Cancel
            </button>
            <span className="text-xs text-muted">
              {rejectReason.trim().length} of {MIN_REJECT} characters
            </span>
          </div>
        </form>
      )}

      {open && active && excluded && excluded.length > 0 && <ExcludedCallout people={excluded} />}

      {open && editable && (
        <div className="flex flex-wrap items-center gap-2">
          {openSlots > 0 && (
            <button type="button" className={BUTTON} disabled={busy} onClick={suggest}>
              <Sparkles className="size-4" aria-hidden="true" />
              Suggest people
            </button>
          )}
          {agent && openSlots > 0 && (
            <>
              <button
                type="button"
                className={BUTTON}
                disabled={busy || !agent.available}
                aria-describedby={agent.reason ? `${line.id}-agent-note` : undefined}
                onClick={() => setAsking((n) => n + 1)}
              >
                <Bot className="size-4" aria-hidden="true" />
                Ask Workforce agent
              </button>
              {agent.reason && (
                <span id={`${line.id}-agent-note`} className="text-xs text-muted">
                  {agent.reason}
                </span>
              )}
            </>
          )}
          {selected.size > 0 && (
            <button
              type="button"
              className={BUTTON}
              disabled={busy}
              onClick={() => startRemoving([...selected])}
            >
              <UserMinus className="size-4" aria-hidden="true" />
              Remove selected ({selected.size})
            </button>
          )}
          {chosen.length === 0 && (
            <span className="text-xs text-muted">
              No one is chosen yet. Pick from the pool, or let the rules suggest people.
            </span>
          )}
        </div>
      )}

      {editable && agent && asking > 0 && (
        <AgentPanel
          key={asking}
          requestNo={requestNo}
          line={line}
          alreadyChosen={chosen.map((p) => p.code)}
          onApplied={onChanged}
          onClose={() => setAsking(0)}
        />
      )}

      {editable && removing && (
        <form
          aria-label={`Remove workers from the ${line.trade.toLowerCase()} line`}
          className="flex flex-col gap-2 rounded-control border border-border bg-sunken p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void confirmRemove();
          }}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            Why {plural(removing.length, "worker")} {removing.length === 1 ? "is" : "are"} taken off
            ({removingNames.join(", ")})?
            <input
              autoFocus
              maxLength={300}
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              className={`${FIELD} font-normal`}
              placeholder="For example, needed on another project"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={PRIMARY_BUTTON}
              disabled={busy || removeReason.trim().length < MIN_REMOVE}
            >
              Remove {plural(removing.length, "worker")}
            </button>
            <button type="button" className={BUTTON} onClick={() => setRemoving(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {line.status === "open" && (chosen.length > 0 || line.picks.length > 0) && (
        <PickList
          picks={line.picks}
          editable={editable}
          selected={selected}
          onToggle={toggle}
          onToggleAll={(all) => setSelected(all ? new Set(chosen.map((p) => p.code)) : new Set())}
          onRemove={startRemoving}
          swapping={swapping}
          onSwap={onSwap}
          onRestore={restore}
          restoreProblems={restoreProblems}
          busy={busy}
        />
      )}

      {open && openSlots > 0 && (
        <div className="rounded-control border border-dashed border-border-strong px-3 py-2 text-sm text-muted">
          {plural(openSlots, "open slot")}
          {editable ? ": choose from the pool" : ""}
        </div>
      )}
    </section>
  );
}
