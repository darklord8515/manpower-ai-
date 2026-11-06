"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useUser } from "@/components/auth/AuthProvider";
import { BUTTON, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api } from "@/lib/api";
import type { ExpiringDocument, Summary } from "@/lib/api-types";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { DEFAULT_QUERY } from "@/lib/workers-query";
import { useLoad } from "@/lib/use-load";
import { ExpiryChart, ProjectsChart, WorkforceDonut } from "./charts";
import {
  LeavingSoon,
  PeopleByTrade,
  PeopleNotAvailable,
  RecruitmentPipeline,
  type Load,
} from "./extra-widgets";
import {
  SPAN_CLASS,
  WIDGETS,
  defaultLayout,
  hide,
  isDefaultLayout,
  move,
  show,
  visibleWidgets,
  type HomeKind,
  type Layout,
  type WidgetId,
} from "./layout";
import { DocumentsDue, ProjectsTable } from "./tables";
import { useHomeLayout } from "./useHomeLayout";

type Props = { kind: HomeKind; summary: Summary; due: ExpiringDocument[] };

function SortableWidget({
  id,
  editing,
  onHide,
  children,
}: {
  id: WidgetId;
  editing: boolean;
  onHide: (id: WidgetId) => void;
  children: ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !editing });
  const title = WIDGETS[id].title;
  return (
    <div
      ref={setNodeRef}
      data-widget={id}
      style={{
        transform: CSS.Translate.toString(transform),
        transition: reduced ? undefined : transition,
        zIndex: isDragging ? 20 : undefined,
      }}
      className={`relative min-w-0 ${SPAN_CLASS[WIDGETS[id].span]} ${
        editing
          ? "grid grid-rows-[auto_1fr] gap-2 rounded-card p-2 outline-1 outline-dashed outline-border-strong"
          : ""
      } ${isDragging ? "opacity-70 shadow-(--shadow-pop)" : ""}`}
    >
      {editing && (
        // The controls sit above the widget, never on top of it, so nothing in its header is covered.
        <div className="flex items-center gap-1 rounded-control border border-border bg-surface p-0.5">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Move ${title}`}
            className="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-control text-muted hover:bg-hover hover:text-fg active:cursor-grabbing"
          >
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
          <span
            className="min-w-0 flex-1 truncate text-xs font-medium text-muted"
            aria-hidden="true"
          >
            {title}
          </span>
          <button
            type="button"
            onClick={() => onHide(id)}
            aria-label={`Hide ${title}`}
            className="grid size-8 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-fg"
          >
            <EyeOff className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      <div
        className={editing ? "pointer-events-none min-h-0 select-none" : "h-full"}
        inert={editing}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The widgets under the KPI tiles. Everyone gets the same default; "Customize" lets a person drag
 * widgets into their own order (mouse, touch, or keyboard) and hide the ones they do not use.
 * Widgets that are hidden are not drawn and ask the server for nothing.
 */
export function HomeGrid({ kind, summary, due }: Props) {
  const user = useUser();
  const canOpenRecruitment = user.permissions.includes("recruitment:read");
  const { status, layout, save } = useHomeLayout(kind);
  const [draft, setDraft] = useState<Layout | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState("");
  const editing = draft !== null;
  const current = draft ?? layout;
  const visible = visibleWidgets(current);
  // Until the saved layout has arrived we do not know what is on screen, so nothing is requested.
  const wants = (...ids: WidgetId[]) =>
    status !== "loading" && ids.some((id) => visible.includes(id));

  // What each widget needs is loaded only while that widget is on screen.
  const recruitment = useLoad(() => api.recruitment(), "recruitment", wants("leaving", "pipeline"));
  const trades = useLoad(() => api.summaryByTrade(), "trades", wants("by_trade"));
  const unavailable = useLoad(
    () => api.workers({ ...DEFAULT_QUERY, status: "unavailable" }),
    "unavailable",
    wants("unavailable"),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const place = (id: string | number) =>
    `${visible.indexOf(String(id) as WidgetId) + 1} of ${visible.length}`;
  const titleOf = (id: string | number) => WIDGETS[String(id) as WidgetId]?.title ?? String(id);
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${titleOf(active.id)}. It is in position ${place(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(active.id)} is over position ${place(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${titleOf(active.id)} in position ${place(over.id)}.`
        : `Dropped ${titleOf(active.id)}.`,
    onDragCancel: ({ active }) => `Moving ${titleOf(active.id)} was cancelled.`,
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) {
      setDraft((d) => (d ? move(d, active.id as WidgetId, over.id as WidgetId) : d));
    }
  }

  async function done() {
    if (!draft) return;
    setSaving(true);
    setProblem("");
    const error = await save(draft);
    setSaving(false);
    if (error) {
      setProblem(error); // the changes stay on screen, so nothing is lost
      return;
    }
    setDraft(null);
    setSaved("Your layout was saved.");
  }

  const canCancelToDefault = draft ? !isDefaultLayout(kind, draft) : false;

  function render(id: WidgetId): ReactNode {
    const asLoad = <T,>(l: ReturnType<typeof useLoad<T>>): Load<T> => ({
      data: l.data,
      error: l.error,
      loading: l.loading,
      retry: l.retry,
    });
    switch (id) {
      case "expiry":
        return <ExpiryChart weeks={summary.expiry_by_week} />;
      case "workforce":
        return <WorkforceDonut workforce={summary.workforce} />;
      case "due":
        return <DocumentsDue rows={due} />;
      case "projects_chart":
        return <ProjectsChart projects={summary.projects} />;
      case "projects_table":
        return <ProjectsTable projects={summary.projects} />;
      case "leaving":
        return <LeavingSoon load={asLoad(recruitment)} canOpen={canOpenRecruitment} />;
      case "pipeline":
        return <RecruitmentPipeline load={asLoad(recruitment)} canOpen={canOpenRecruitment} />;
      case "by_trade":
        return <PeopleByTrade load={asLoad(trades)} />;
      case "unavailable":
        return (
          <PeopleNotAvailable load={asLoad(unavailable)} total={summary.workforce.unavailable} />
        );
    }
  }

  if (status === "loading") {
    return (
      <div className="grid gap-4 lg:grid-cols-3" aria-busy="true">
        <div className="skeleton h-80 rounded-card lg:col-span-2" />
        <div className="skeleton h-80 rounded-card" />
      </div>
    );
  }

  return (
    <section aria-label="Your widgets" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {editing ? (
          <>
            <p className="m-0 text-sm text-muted" id="home-edit-help">
              Drag the handle on a widget to move it, or focus the handle, press Space, then use the
              arrow keys. Hide what you don&rsquo;t use.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={PRIMARY_BUTTON} onClick={done} disabled={saving}>
                {saving ? "Saving…" : "Done"}
              </button>
              <button
                type="button"
                className={BUTTON}
                onClick={() => setDraft(defaultLayout(kind))}
                disabled={saving || !canCancelToDefault}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                Reset to default
              </button>
              <button
                type="button"
                className={BUTTON}
                onClick={() => {
                  setDraft(null);
                  setProblem("");
                }}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            <p role="status" className="m-0 text-sm text-success-text empty:hidden">
              {saved}
            </p>
            <button
              type="button"
              className={`${BUTTON} ml-auto`}
              onClick={() => {
                setSaved("");
                setDraft(layout);
              }}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Customize
            </button>
          </>
        )}
      </div>
      {status === "unreadable" && !editing && (
        <p role="status" className="m-0 text-xs text-muted">
          We couldn&rsquo;t load your saved layout, so you are seeing the standard one.
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

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        accessibility={{ announcements }}
      >
        <SortableContext items={visible} strategy={rectSortingStrategy}>
          <div className="grid gap-4 lg:grid-cols-3" data-editing={editing || undefined}>
            {visible.map((id) => (
              <SortableWidget
                key={id}
                id={id}
                editing={editing}
                onHide={(w) => setDraft((d) => (d ? hide(d, w) : d))}
              >
                {render(id)}
              </SortableWidget>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {visible.length === 0 && (
        <p className="m-0 rounded-card border border-dashed border-border-strong p-6 text-center text-sm text-muted">
          Every widget is hidden.{" "}
          {editing ? "Show one from the list below." : "Choose Customize to bring some back."}
        </p>
      )}

      {editing && current.hidden.length > 0 && (
        <div className="rounded-card border border-border bg-surface p-4">
          <h2 className="m-0 text-sm font-semibold">Hidden widgets</h2>
          <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-border p-0">
            {current.hidden.map((id) => (
              <li
                key={id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  <span className="font-medium">{WIDGETS[id].title}</span>
                  <span className="block text-xs text-muted">{WIDGETS[id].about}</span>
                </span>
                <button
                  type="button"
                  className={BUTTON}
                  onClick={() => setDraft((d) => (d ? show(d, id) : d))}
                  aria-label={`Show ${WIDGETS[id].title}`}
                >
                  <Eye className="size-4" aria-hidden="true" />
                  Show
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
