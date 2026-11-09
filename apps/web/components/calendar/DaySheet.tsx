"use client";

import { CalendarPlus, Trash2, UserMinus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { BUTTON, FIELD, PRIMARY_BUTTON, SMALL_BUTTON } from "@/components/ui/button-styles";
import { DetailSheet } from "@/components/ui/DetailSheet";
import { EmptyState } from "@/components/ui/EmptyState";
import { api, ApiError } from "@/lib/api";
import type { CalendarEntry, NewEvent, NewLeave } from "@/lib/api-types";
import { KIND } from "@/lib/calendar";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

type Mode = "list" | "event" | "leave";

type Props = {
  /** The day opened; null closes the sheet. */
  day: string | null;
  entries: CalendarEntry[];
  canEdit: boolean;
  /** Something was added or removed: show it, and say what happened. */
  onChanged: (notice: string) => void;
  onClose: () => void;
};

const messageOf = (e: unknown) =>
  e instanceof ApiError ? e.message : "Something went wrong. Try again.";

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function AddEvent({
  day,
  onDone,
  onCancel,
}: {
  day: string;
  onDone: (n: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    title: "",
    ends: "",
    kind: "event" as NewEvent["kind"],
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.addCalendarEvent({
        title: form.title,
        starts_on: day,
        ...(form.ends ? { ends_on: form.ends } : {}),
        kind: form.kind,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      });
      onDone(`“${form.title.trim()}” was added to the calendar.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Add an event">
      <Field id="ev-title" label="What is happening">
        <input
          id="ev-title"
          className={FIELD}
          required
          minLength={2}
          maxLength={120}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          autoFocus
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="ev-kind" label="Type">
          <select
            id="ev-kind"
            className={FIELD}
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as NewEvent["kind"] })}
          >
            <option value="event">Event</option>
            <option value="meeting">Meeting</option>
            <option value="deadline">Deadline</option>
          </select>
        </Field>
        <Field id="ev-end" label="Ends on (optional)">
          <input
            id="ev-end"
            type="date"
            className={FIELD}
            min={day}
            value={form.ends}
            onChange={(e) => setForm({ ...form, ends: e.target.value })}
          />
        </Field>
      </div>
      <Field id="ev-note" label="Note (optional)">
        <textarea
          id="ev-note"
          rows={2}
          maxLength={500}
          value={form.note}
          className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm"
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </Field>
      {error && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className={PRIMARY_BUTTON}
          disabled={busy || form.title.trim().length < 2}
        >
          {busy ? "Adding…" : "Add to calendar"}
        </button>
        <button type="button" className={BUTTON} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function AddLeave({
  day,
  onDone,
  onCancel,
}: {
  day: string;
  onDone: (n: string) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    code: "",
    ends: day,
    type: "annual" as NewLeave["leave_type"],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const made = await api.addLeave({
        employee_code: form.code.trim().toUpperCase(),
        leave_type: form.type,
        starts_on: day,
        ends_on: form.ends,
      });
      onDone(`${made.title} from ${formatDate(day)} to ${formatDate(form.ends)}.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label="Add a leave">
      <Field id="lv-code" label="Employee code">
        <input
          id="lv-code"
          className={FIELD}
          required
          placeholder="EMP-0142"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          autoFocus
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="lv-type" label="Type of leave">
          <select
            id="lv-type"
            className={FIELD}
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value as NewLeave["leave_type"] })}
          >
            <option value="annual">Annual</option>
            <option value="sick">Sick</option>
            <option value="emergency">Emergency</option>
            <option value="unpaid">Unpaid</option>
          </select>
        </Field>
        <Field id="lv-end" label="Last day of leave">
          <input
            id="lv-end"
            type="date"
            className={FIELD}
            required
            min={day}
            value={form.ends}
            onChange={(e) => setForm({ ...form, ends: e.target.value })}
          />
        </Field>
      </div>
      <p className="m-0 text-xs text-muted">
        Starts on {formatDate(day)}. The worker is not offered for allocation while on leave.
      </p>
      {error && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className={PRIMARY_BUTTON}
          disabled={busy || !form.code.trim() || !form.ends}
        >
          {busy ? "Adding…" : "Add leave"}
        </button>
        <button type="button" className={BUTTON} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** One day: what is on it, and (for HR) adding an event or a leave and removing what HR added. */
export function DaySheet({ day, entries, canEdit, onChanged, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("list");
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(entry: CalendarEntry) {
    setRemoving(entry.id);
    setError(null);
    try {
      const [type, id] = entry.id.split(":");
      if (type === "leave") await api.removeLeave(id);
      else await api.removeCalendarEvent(id);
      onChanged(`“${entry.title}” was removed.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setRemoving(null);
    }
  }
  const done = (notice: string) => {
    setMode("list");
    onChanged(notice);
  };
  const close = () => {
    setMode("list");
    setError(null);
    onClose();
  };

  return (
    <DetailSheet
      open={day !== null}
      onOpenChange={(open) => !open && close()}
      title={day ? formatDate(day) : "Day"}
      meta={
        <span>
          {entries.length === 0 ? "Nothing on this day" : `${entries.length} on this day`}
        </span>
      }
    >
      {day && mode === "event" && (
        <AddEvent day={day} onDone={done} onCancel={() => setMode("list")} />
      )}
      {day && mode === "leave" && (
        <AddLeave day={day} onDone={done} onCancel={() => setMode("list")} />
      )}
      {mode === "list" && (
        <>
          {canEdit && day && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BUTTON} onClick={() => setMode("event")}>
                <CalendarPlus className="size-4" aria-hidden="true" />
                Add an event
              </button>
              <button type="button" className={BUTTON} onClick={() => setMode("leave")}>
                <UserMinus className="size-4" aria-hidden="true" />
                Add a leave
              </button>
            </div>
          )}
          {error && (
            <p
              role="alert"
              className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
            >
              {error}
            </p>
          )}
          {entries.length === 0 ? (
            <EmptyState icon={CalendarPlus} title="A free day">
              {canEdit
                ? "Add an event or a leave for this day."
                : "Nothing is planned for this day."}
            </EmptyState>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {entries.map((e) => (
                <li key={e.id} className="rounded-card border border-border p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        "rounded-control px-2 py-0.5 text-xs font-medium",
                        KIND[e.kind].chip,
                      )}
                    >
                      {KIND[e.kind].label}
                      {e.expected ? " (expected)" : ""}
                    </span>
                    {e.editable && (
                      <button
                        type="button"
                        className={SMALL_BUTTON}
                        onClick={() => remove(e)}
                        disabled={removing === e.id}
                        aria-label={`Remove ${e.title}`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                        {removing === e.id ? "Removing…" : "Remove"}
                      </button>
                    )}
                  </div>
                  <p className="m-0 mt-2 font-medium">{e.title}</p>
                  {e.detail && <p className="m-0 mt-0.5 text-xs text-muted">{e.detail}</p>}
                  {e.starts !== e.ends && (
                    <p className="m-0 mt-0.5 text-xs text-muted">
                      {formatDate(e.starts)} to {formatDate(e.ends)}
                    </p>
                  )}
                  {e.href && (
                    <Link
                      href={e.href}
                      className="mt-1 inline-block text-xs text-accent-text hover:underline"
                    >
                      Open
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </DetailSheet>
  );
}
