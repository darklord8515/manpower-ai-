"use client";

import { CheckCircle2, Inbox } from "lucide-react";
import { useState } from "react";
import { PageTransition } from "@/components/motion/PageTransition";
import { Reveal } from "@/components/motion/Reveal";
import { SlidingTabs, type Tab } from "@/components/motion/SlidingTabs";
import { StateSwap } from "@/components/motion/StateSwap";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";

const BUTTON =
  "press inline-flex h-8 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-sm font-medium transition-[transform,background-color] duration-120 hover:bg-hover";

const TABS: Tab[] = [
  { id: "expired", label: "Expired", count: 2 },
  { id: "d30", label: "Next 30 days", count: 8 },
  { id: "d60", label: "31–60 days", count: 11 },
  { id: "d90", label: "61–90 days", count: 17 },
];

const STATES = ["data", "loading", "empty", "error"] as const;
const STATE_LABEL = {
  data: "Ready",
  loading: "Waiting",
  empty: "Nothing",
  error: "Failed",
} as const;
const ROWS = ["Anil Kumar", "Bikash Rai", "Mohammed Salim", "Suresh Nair", "Joseph Mathew"];

/** Gallery section for the motion primitives. Each demo shows one behaviour and its trigger. */
export function MotionDemo() {
  const [tab, setTab] = useState("d30");
  const [replay, setReplay] = useState(0);
  const [state, setState] = useState<(typeof STATES)[number]>("data");
  const [page, setPage] = useState(1);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">SlidingTabs</h3>
        <p className="text-xs text-muted">The highlight slides to the chosen option.</p>
        <SlidingTabs tabs={TABS} value={tab} onChange={setTab} label="When it expires" />
        <p className="text-xs text-muted" aria-live="polite">
          Showing: {TABS.find((t) => t.id === tab)?.label}
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Reveal</h3>
          <button
            type="button"
            className={`${BUTTON} ml-auto`}
            onClick={() => setReplay((n) => n + 1)}
          >
            Replay
          </button>
        </div>
        <p className="text-xs text-muted">First rows rise in 25ms apart, once. At most 8.</p>
        <ul key={replay} className="m-0 list-none p-0">
          {ROWS.map((name, i) => (
            <li key={name} className="border-t border-border first:border-t-0">
              <Reveal index={i} className="px-1 py-2 text-sm">
                {name}
              </Reveal>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <h3 className="text-sm font-semibold">StateSwap</h3>
        <p className="text-xs text-muted">
          Loading, empty and error cross-fade instead of jumping.
        </p>
        <SlidingTabs
          tabs={STATES.map((s) => ({ id: s, label: STATE_LABEL[s] }))}
          value={state}
          onChange={(id) => setState(id as (typeof STATES)[number])}
          label="Screen state"
        />
        <StateSwap stateKey={state} className="min-h-40">
          {state === "loading" && <SkeletonLoader label="Loading" count={3} />}
          {state === "empty" && (
            <EmptyState icon={Inbox} title="Nothing waiting">
              New items appear here as soon as they arrive.
            </EmptyState>
          )}
          {state === "error" && (
            <ErrorState title="Couldn’t load" onRetry={() => setState("data")}>
              The server didn’t answer. Try again in a moment.
            </ErrorState>
          )}
          {state === "data" && (
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-success-text" aria-hidden="true" />
              12 workers loaded.
            </p>
          )}
        </StateSwap>
      </div>

      <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">PageTransition</h3>
          <button
            type="button"
            className={`${BUTTON} ml-auto`}
            onClick={() => setPage((n) => n + 1)}
          >
            Next page
          </button>
        </div>
        <p className="text-xs text-muted">Content rises 4px and fades in when the page changes.</p>
        <PageTransition transitionKey={`page-${page}`} className="text-sm">
          Page {page}
        </PageTransition>
      </div>
    </div>
  );
}
