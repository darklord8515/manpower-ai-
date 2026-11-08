"use client";

import { Check, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { api, ApiError } from "@/lib/api";
import type { WorkerDetail, WorkerEditBody } from "@/lib/api-types";
import { useLoad } from "@/lib/use-load";

const REASONS = [
  ["", "No leaving date"],
  ["resigned", "Resigned"],
  ["terminated", "Terminated"],
  ["absconded", "Left without notice"],
  ["contract_ended", "Contract ended"],
  ["other", "Other"],
] as const;

function Label({ id, text, children }: { id: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-muted">
        {text}
      </label>
      {children}
    </div>
  );
}

type Props = {
  worker: WorkerDetail;
  /** Saved: the fresh profile, and what happened in words. */
  onSaved: (worker: WorkerDetail, notice: string) => void;
  onCancel: () => void;
};

/** HR edits what is wrong or has changed. Only changed fields are sent; the server checks each one. */
export function EditWorker({ worker, onSaved, onCancel }: Props) {
  const trades = useLoad(() => api.trades(), "trades");
  const [form, setForm] = useState({
    full_name: worker.name,
    trade: worker.trade,
    level: String(worker.level ?? ""),
    designation: worker.designation ?? "",
    phone: worker.phone ?? "",
    whatsapp: "",
    contract_end_on: worker.contract_end_on ?? "",
    exit_on: worker.exit_on ?? "",
    exit_reason: worker.exit_reason ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  function changes(): WorkerEditBody {
    const body: WorkerEditBody = {};
    if (form.full_name.trim() !== worker.name) body.full_name = form.full_name.trim();
    if (form.trade !== worker.trade) body.trade = form.trade;
    if (form.level && Number(form.level) !== worker.level) body.level = Number(form.level);
    if (form.designation !== (worker.designation ?? ""))
      body.designation = form.designation || null;
    if (form.phone !== (worker.phone ?? "")) body.phone = form.phone || null;
    if (form.whatsapp.trim()) body.whatsapp_number = form.whatsapp.trim();
    if (form.contract_end_on !== (worker.contract_end_on ?? ""))
      body.contract_end_on = form.contract_end_on || null;
    if (form.exit_on !== (worker.exit_on ?? "")) body.exit_on = form.exit_on || null;
    if (form.exit_reason !== (worker.exit_reason ?? ""))
      body.exit_reason = (form.exit_reason || null) as WorkerEditBody["exit_reason"];
    return body;
  }
  const pending = Object.keys(changes()).length;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending === 0) return;
    setSaving(true);
    setError(null);
    try {
      const fresh = await api.editWorker(worker.code, changes());
      onSaved(fresh, `${fresh.name}’s details were saved.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn’t save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3" aria-label={`Edit ${worker.name}`}>
      <Label id="ew-name" text="Full name">
        <input
          id="ew-name"
          className={FIELD}
          value={form.full_name}
          required
          minLength={2}
          onChange={(e) => set("full_name")(e.target.value)}
        />
      </Label>
      <div className="grid grid-cols-[1fr_96px] gap-3">
        <Label id="ew-trade" text="Trade">
          <select
            id="ew-trade"
            className={FIELD}
            value={form.trade}
            onChange={(e) => set("trade")(e.target.value)}
          >
            {(trades.data ?? [{ name: worker.trade }]).map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </Label>
        <Label id="ew-level" text="Level (1-5)">
          <select
            id="ew-level"
            className={FIELD}
            value={form.level}
            onChange={(e) => set("level")(e.target.value)}
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Label>
      </div>
      <Label id="ew-designation" text="Designation">
        <input
          id="ew-designation"
          className={FIELD}
          value={form.designation}
          maxLength={80}
          onChange={(e) => set("designation")(e.target.value)}
        />
      </Label>
      <div className="grid grid-cols-2 gap-3">
        <Label id="ew-phone" text="Phone">
          <input
            id="ew-phone"
            className={FIELD}
            inputMode="tel"
            placeholder="+971 50 123 4567"
            value={form.phone}
            onChange={(e) => set("phone")(e.target.value)}
          />
        </Label>
        <Label id="ew-whatsapp" text="WhatsApp (leave blank to keep)">
          <input
            id="ew-whatsapp"
            className={FIELD}
            inputMode="tel"
            value={form.whatsapp}
            onChange={(e) => set("whatsapp")(e.target.value)}
          />
        </Label>
      </div>
      <Label id="ew-contract" text="Contract ends">
        <input
          id="ew-contract"
          type="date"
          className={FIELD}
          value={form.contract_end_on}
          onChange={(e) => set("contract_end_on")(e.target.value)}
        />
      </Label>
      <div className="grid grid-cols-2 gap-3">
        <Label id="ew-exit" text="Leaving on">
          <input
            id="ew-exit"
            type="date"
            className={FIELD}
            value={form.exit_on}
            onChange={(e) => set("exit_on")(e.target.value)}
          />
        </Label>
        <Label id="ew-reason" text="Reason">
          <select
            id="ew-reason"
            className={FIELD}
            value={form.exit_reason}
            onChange={(e) => set("exit_reason")(e.target.value)}
            disabled={!form.exit_on}
          >
            {REASONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Label>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
        >
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving || pending === 0} className={PRIMARY_BUTTON}>
          <Save className="size-4" aria-hidden="true" />
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button type="button" onClick={onCancel} className={BUTTON} disabled={saving}>
          Cancel
        </button>
        {pending > 0 && (
          <span className="flex items-center gap-1 text-xs text-muted">
            <Check className="size-3.5" aria-hidden="true" />
            {pending} change{pending === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </form>
  );
}
