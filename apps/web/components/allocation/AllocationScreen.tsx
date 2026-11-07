"use client";

import { Ban, Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { ErrorState } from "@/components/ui/ErrorState";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { ApproveResponse, RequestDetail, Violation } from "@/lib/api-types";
import { formatDate } from "@/lib/format";
import { useAddress } from "@/lib/use-address";
import { useLoad } from "@/lib/use-load";
import { ApprovalDialog } from "./ApprovalDialog";
import { CandidatePool, type PoolFilters } from "./CandidatePool";
import { LineCard } from "./LineCard";
import { NewRequestSheet } from "./NewRequestSheet";
import { RequestBar, type RequestFilters } from "./RequestBar";
import { RequestStatusChip, plural } from "./parts";

const CLOSED = ["filled", "rejected", "cancelled"];
const NO_PROBLEMS: Record<string, Violation[]> = {};

type Banner = {
  tone: "success" | "error";
  text: string;
  /** Where to go next, e.g. to the mobilizations an approval just started. */
  link?: { href: string; label: string };
} | null;

/** "MOB-2026-0001 to MOB-2026-0007", or the one number, or nothing. */
function mobilizationNumbers(result: ApproveResponse): string {
  const numbers = result.people.map((p) => p.mob_no).filter((n): n is string => Boolean(n));
  if (numbers.length === 0) return "";
  const sorted = [...numbers].sort();
  return sorted.length === 1
    ? ` (${sorted[0]})`
    : ` (${sorted[0]} to ${sorted[sorted.length - 1]})`;
}

/** Requests waiting for people, and the board where HR fills them line by line. */
export function AllocationScreen() {
  const user = useUser();
  const canPrepare = user.permissions.includes("staffing:create");
  const canOpenMobilization = user.permissions.includes("mobilization:read");

  const [filters, setFilters] = useState<RequestFilters>({ q: "", status: "", project: "" });
  const [search, setSearch] = useState("");
  const address = useAddress();
  const [picked, setPicked] = useState<string | null>(() =>
    new URLSearchParams(address).get("request"),
  );
  const [activeLine, setActiveLine] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // goes up after every change made on the server
  const [banner, setBanner] = useState<Banner>(null);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const [poolFilters, setPoolFilters] = useState<PoolFilters>({
    q: "",
    minLevel: 0,
    documentsValid: false,
  });
  const [poolSearch, setPoolSearch] = useState("");
  const [problems, setProblems] = useState(NO_PROBLEMS);
  const [poolBusy, setPoolBusy] = useState(false);

  const requests = useLoad(
    () => api.requests(filters),
    `${filters.q}|${filters.status}|${filters.project}|${version}`,
  );
  // Until HR picks one, the board shows the first request in the list.
  const selectedNo = picked ?? requests.data?.[0]?.request_no ?? null;
  const detail = useLoad(
    () => api.requestDetail(selectedNo ?? ""),
    `${selectedNo}|${version}`,
    selectedNo !== null,
  );
  const projects = useLoad(() => api.projects(), "projects");
  const trades = useLoad(() => api.trades(), "trades", canPrepare);

  const request: RequestDetail | null =
    detail.data && detail.data.request_no === selectedNo ? detail.data : null;
  const requestOpen = request ? !CLOSED.includes(request.status) : false;
  const line =
    request?.lines.find((l) => l.id === activeLine) ??
    request?.lines.find((l) => l.status === "open") ??
    request?.lines[0] ??
    null;
  const poolOn = canPrepare && requestOpen && line?.status === "open";

  // The pool is loaded for one line at a time. The answer carries the line it was loaded for, so
  // a slow answer for another line is never shown under this one.
  const pool = useLoad(
    async () => {
      const answer = await api.lineCandidates(selectedNo ?? "", line?.id ?? "", {
        q: poolFilters.q,
        minLevel: poolFilters.minLevel,
        documentsValid: poolFilters.documentsValid,
      });
      return { lineId: line?.id ?? "", ...answer };
    },
    `${selectedNo}|${line?.id}|${poolFilters.q}|${poolFilters.minLevel}|${poolFilters.documentsValid}|${version}`,
    Boolean(poolOn && line),
  );
  const poolData = pool.data && pool.data.lineId === line?.id ? pool.data : null;

  const change = useCallback((changes: Partial<RequestFilters>) => {
    setFilters((f) => ({ ...f, ...changes }));
  }, []);

  // The search boxes wait for a pause in typing before asking the API.
  useEffect(() => {
    if (search === filters.q) return;
    const timer = window.setTimeout(() => change({ q: search }), 250);
    return () => window.clearTimeout(timer);
  }, [search, filters.q, change]);
  useEffect(() => {
    if (poolSearch === poolFilters.q) return;
    const timer = window.setTimeout(() => setPoolFilters((f) => ({ ...f, q: poolSearch })), 250);
    return () => window.clearTimeout(timer);
  }, [poolSearch, poolFilters.q]);

  useEffect(() => {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${selectedNo ? `?request=${encodeURIComponent(selectedNo)}` : ""}`,
    );
  }, [selectedNo]);

  function select(no: string) {
    if (no === selectedNo) return;
    setPicked(no);
    setActiveLine(null);
    setSwapping(null);
    setProblems(NO_PROBLEMS);
    setCancelling(false);
    setBanner(null);
    setPoolSearch("");
    setPoolFilters({ q: "", minLevel: 0, documentsValid: false });
  }

  const changed = useCallback((text: string, link?: { href: string; label: string }) => {
    setBanner({ tone: "success", text, link });
    setProblems(NO_PROBLEMS);
    setVersion((v) => v + 1);
  }, []);

  async function add(code: string) {
    if (!request || !line) return;
    setPoolBusy(true);
    setProblems(NO_PROBLEMS);
    setBanner(null);
    const incoming = poolData?.candidates.find((c) => c.code === code);
    const outgoing = swapping ? line.picks.find((p) => p.code === swapping) : undefined;
    try {
      if (outgoing) {
        // The line is full, so the old person comes off first. If the rules refuse the new
        // one, the old person goes straight back on.
        await api.removePerson(
          request.request_no,
          line.id,
          outgoing.code,
          `Swapped for ${incoming?.name ?? code}`,
        );
      }
      const result = await api.choosePeople(request.request_no, line.id, [code]);
      const first = result.results[0];
      if (first?.outcome === "refused") {
        if (outgoing) await api.restorePerson(request.request_no, line.id, outgoing.code);
        setProblems({ [code]: first.violations });
        setVersion((v) => v + 1);
        return;
      }
      setSwapping(null);
      changed(
        outgoing
          ? `${incoming?.name ?? code} replaces ${outgoing.name}.`
          : `${incoming?.name ?? code} was added to the ${line.trade.toLowerCase()} line.`,
      );
    } catch (e) {
      setBanner({
        tone: "error",
        text: e instanceof ApiError ? e.message : "Couldn’t update the line. Try again.",
      });
      setVersion((v) => v + 1);
    } finally {
      setPoolBusy(false);
    }
  }

  function approved(result: ApproveResponse) {
    setApproving(null);
    changed(
      `Approved ${plural(result.people.length, "worker")} as ${result.trade.toLowerCase()}. ` +
        `${plural(result.mobilizations, "mobilization")} started${mobilizationNumbers(result)}.`,
      canOpenMobilization ? { href: "/mobilization", label: "Open the pipeline" } : undefined,
    );
  }

  async function cancelRequest() {
    if (!request) return;
    setCancelBusy(true);
    try {
      await api.cancelRequest(request.request_no, cancelReason.trim());
      setCancelling(false);
      setCancelReason("");
      changed(`${request.request_no} was cancelled.`);
    } catch (e) {
      setBanner({
        tone: "error",
        text: e instanceof ApiError ? e.message : "Couldn’t cancel. Try again.",
      });
    } finally {
      setCancelBusy(false);
    }
  }

  const canCancel =
    canPrepare &&
    request !== null &&
    requestOpen &&
    request.lines.every((l) => l.filled === 0 && l.status === "open");
  const swappingName = line?.picks.find((p) => p.code === swapping)?.name ?? null;
  const chosenCount = line?.picks.filter((p) => p.removed_reason === null).length ?? 0;

  return (
    <div
      className="flex flex-col gap-4"
      onKeyDown={(e) => {
        if (e.key === "Escape" && swapping) setSwapping(null);
      }}
    >
      <h1 className="sr-only">Allocation</h1>

      {banner && (
        <p
          role={banner.tone === "error" ? "alert" : "status"}
          className={`m-0 rounded-control px-3 py-2 text-sm ${
            banner.tone === "error"
              ? "bg-danger-soft text-danger-text"
              : "bg-success-soft text-success-text"
          }`}
        >
          {banner.text}
          {banner.link && (
            <>
              {" "}
              <Link href={banner.link.href} className="font-medium underline underline-offset-2">
                {banner.link.label}
              </Link>
            </>
          )}
        </p>
      )}

      <RequestBar
        requests={requests.data}
        loading={requests.loading}
        error={requests.error}
        onRetry={requests.retry}
        selected={selectedNo}
        onSelect={select}
        filters={filters}
        search={search}
        onSearch={setSearch}
        onFilters={change}
        projects={projects.data ?? []}
        action={
          canPrepare && trades.data && projects.data ? (
            <button type="button" className={PRIMARY_BUTTON} onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden="true" />
              New request
            </button>
          ) : undefined
        }
      />

      {selectedNo && (
        <div
          className={`grid gap-4 ${poolOn ? "lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start" : ""}`}
        >
          <section aria-label="Selected request" className="flex min-w-0 flex-col gap-3">
            {detail.error && !request ? (
              <ErrorState title="Couldn’t open the request" onRetry={detail.retry}>
                {detail.error}
              </ErrorState>
            ) : !request ? (
              <div
                role="status"
                aria-busy="true"
                aria-label="Loading the request"
                className="flex flex-col gap-3"
              >
                <div className="skeleton h-12 rounded-card" />
                <div className="skeleton h-56 rounded-card" />
              </div>
            ) : (
              <>
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="m-0 flex flex-wrap items-center gap-2 text-lg font-semibold">
                      <span className="font-mono text-md">{request.request_no}</span>
                      <span className="truncate">{request.project_name}</span>
                      <RequestStatusChip status={request.status} />
                    </h2>
                    <p className="m-0 mt-1 text-xs text-muted">
                      {request.project_code} · needed from {formatDate(request.needed_from)}
                      {request.needed_until ? ` to ${formatDate(request.needed_until)}` : ""} ·
                      raised by {request.requested_by}
                      {request.waiting_days > 0 && requestOpen
                        ? `, waiting ${plural(request.waiting_days, "day")}`
                        : ""}
                    </p>
                    {request.source_text && (
                      <p className="m-0 mt-1 text-xs text-muted">Note: {request.source_text}</p>
                    )}
                  </div>
                  {canCancel && !cancelling && (
                    <button type="button" className={BUTTON} onClick={() => setCancelling(true)}>
                      <Ban className="size-4" aria-hidden="true" />
                      Cancel request
                    </button>
                  )}
                </header>

                {cancelling && (
                  <form
                    aria-label={`Cancel ${request.request_no}`}
                    className="flex flex-col gap-2 rounded-control border border-border bg-sunken p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void cancelRequest();
                    }}
                    onKeyDown={(e) => e.key === "Escape" && setCancelling(false)}
                  >
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      Why is {request.request_no} cancelled?
                      <input
                        autoFocus
                        maxLength={500}
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                        className={`${FIELD} font-normal`}
                      />
                    </label>
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        className={PRIMARY_BUTTON}
                        disabled={cancelBusy || cancelReason.trim().length < 3}
                      >
                        Cancel request
                      </button>
                      <button type="button" className={BUTTON} onClick={() => setCancelling(false)}>
                        Keep it
                      </button>
                    </div>
                  </form>
                )}

                {request.lines.map((l) => (
                  <LineCard
                    key={l.id}
                    requestNo={request.request_no}
                    line={l}
                    requestOpen={requestOpen}
                    canPrepare={canPrepare}
                    canOpenMobilization={canOpenMobilization}
                    canApprove={request.can_approve}
                    approveNote={request.approve_note}
                    active={l.id === line?.id}
                    onActivate={() => {
                      if (l.id !== line?.id) {
                        setActiveLine(l.id);
                        setSwapping(null);
                        setProblems(NO_PROBLEMS);
                      }
                    }}
                    excluded={l.id === line?.id ? (poolData?.excluded ?? null) : null}
                    swapping={l.id === line?.id ? swapping : null}
                    onSwap={setSwapping}
                    onChanged={changed}
                    onApprove={() => setApproving(l.id)}
                  />
                ))}
              </>
            )}
          </section>

          {poolOn && request && line && (
            <CandidatePool
              trade={line.trade}
              data={poolData}
              loading={pool.loading || (!poolData && !pool.error)}
              error={pool.error}
              onRetry={pool.retry}
              filters={poolFilters}
              search={poolSearch}
              onSearch={setPoolSearch}
              onFilters={(changes) => setPoolFilters((f) => ({ ...f, ...changes }))}
              full={chosenCount >= line.headcount}
              swappingName={swappingName}
              busy={poolBusy}
              onAdd={add}
              problems={problems}
              window={{ from: request.needed_from, until: request.needed_until }}
            />
          )}
        </div>
      )}

      {approving && request && (
        <ApprovalDialog
          requestNo={request.request_no}
          lineId={approving}
          trade={request.lines.find((l) => l.id === approving)?.trade ?? "workers"}
          onApproved={approved}
          onClose={() => setApproving(null)}
        />
      )}

      {canPrepare && trades.data && projects.data && (
        <NewRequestSheet
          open={adding}
          onClose={() => setAdding(false)}
          projects={projects.data}
          trades={trades.data}
          onCreated={(created) => {
            setAdding(false);
            setFilters({ q: "", status: "", project: "" });
            setSearch("");
            setPicked(created.request_no);
            setActiveLine(null);
            changed(`${created.request_no} was sent for approval.`);
          }}
        />
      )}
    </div>
  );
}
