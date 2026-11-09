"use client";

import { Mail, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { BUTTON, FIELD, PRIMARY_BUTTON } from "@/components/ui/button-styles";
import { SkeletonLoader } from "@/components/ui/SkeletonLoader";
import { api, ApiError } from "@/lib/api";
import type { EmailBody, EmailPreview, WorkerDetail } from "@/lib/api-types";

type Props = {
  worker: WorkerDetail;
  /** The profile changed (a new address was saved) or an email went out. */
  onDone: (notice: string) => void;
  onCancel: () => void;
};

const messageOf = (e: unknown) =>
  e instanceof ApiError ? e.message : "Something went wrong. Try again.";

/**
 * HR writes to the worker: a renewal request built from their documents, or their own words. The
 * address is the one HR keeps on the worker and can change here; the exact email is shown before
 * it is sent. n8n delivers it from the company mail account.
 */
export function EmailWorker({ worker, onDone, onCancel }: Props) {
  const [address, setAddress] = useState(worker.email ?? "");
  const [saved, setSaved] = useState(worker.email ?? "");
  const [template, setTemplate] = useState<EmailBody["template"]>("document_renewal");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [read, setPreview] = useState<EmailPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<"address" | "send" | null>(null);

  const body: EmailBody =
    template === "document_renewal" ? { template } : { template, subject, message };
  const ready =
    saved !== "" && (template === "document_renewal" || (subject.trim() && message.trim()));

  const preview = ready ? read : null; // nothing shown for a form that is not ready
  // Show the exact email whenever what it is built from changes (typing waits a moment).
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .previewWorkerEmail(worker.code, body)
        .then((p) => {
          if (stopped) return;
          setPreview(p);
          setProblem(null);
        })
        .catch((e: unknown) => {
          if (stopped) return;
          setPreview(null);
          setProblem(messageOf(e));
        })
        .finally(() => !stopped && setLoading(false));
    }, 350);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // `body` is rebuilt from these three values on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worker.code, saved, template, subject, message, ready]);

  async function saveAddress() {
    setBusy("address");
    setProblem(null);
    try {
      await api.editWorker(worker.code, { email: address.trim() || null });
      setSaved(address.trim().toLowerCase());
      setAddress(address.trim().toLowerCase());
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy("send");
    setProblem(null);
    try {
      const sent = await api.sendWorkerEmail(worker.code, body);
      onDone(`Email sent to ${sent.to}.`);
    } catch (e) {
      setProblem(messageOf(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label={`Email ${worker.name}`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="mail-address" className="text-xs font-medium text-muted">
          Send to
        </label>
        <div className="flex gap-2">
          <input
            id="mail-address"
            type="email"
            className={FIELD}
            value={address}
            placeholder="worker@example.com"
            onChange={(e) => setAddress(e.target.value)}
          />
          <button
            type="button"
            className={BUTTON}
            onClick={saveAddress}
            disabled={busy !== null || address.trim().toLowerCase() === saved}
          >
            {busy === "address" ? "Saving…" : "Save address"}
          </button>
        </div>
        {saved === "" && (
          <p className="m-0 text-xs text-muted">
            {worker.name} has no email address yet. Add one to write to them.
          </p>
        )}
      </div>

      <fieldset className="m-0 flex gap-2 border-0 p-0">
        <legend className="mb-1 text-xs font-medium text-muted">What to send</legend>
        {(
          [
            ["document_renewal", "Renew documents"],
            ["custom", "Write my own"],
          ] as const
        ).map(([id, label]) => (
          <label
            key={id}
            className="flex cursor-pointer items-center gap-2 rounded-control border border-border-strong px-3 py-1.5 text-sm has-checked:bg-hover has-checked:font-medium"
          >
            <input
              type="radio"
              name="mail-template"
              checked={template === id}
              onChange={() => setTemplate(id)}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {template === "custom" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="mail-subject" className="text-xs font-medium text-muted">
              Subject
            </label>
            <input
              id="mail-subject"
              className={FIELD}
              maxLength={120}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="mail-message" className="text-xs font-medium text-muted">
              Message
            </label>
            <textarea
              id="mail-message"
              rows={4}
              maxLength={1500}
              className="w-full rounded-control border border-border-strong bg-surface px-3 py-2 text-sm"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>
      )}

      <div aria-live="polite" className="flex flex-col gap-2">
        {loading && <SkeletonLoader label="Preparing the email" variant="lines" count={3} />}
        {!loading && preview && (
          <article className="rounded-card border border-border bg-sunken p-3 text-sm">
            <p className="m-0 text-xs text-muted">
              To <b className="text-fg">{preview.to}</b>
            </p>
            <p className="mt-1 mb-2 font-semibold">{preview.subject}</p>
            <pre className="m-0 font-sans text-sm whitespace-pre-wrap">{preview.body}</pre>
          </article>
        )}
        {problem && (
          <p
            role="alert"
            className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text"
          >
            {problem}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          onClick={send}
          disabled={!preview || busy !== null || loading}
        >
          {busy === "send" ? (
            "Sending…"
          ) : (
            <>
              <Send className="size-4" aria-hidden="true" />
              Send email
            </>
          )}
        </button>
        <button type="button" className={BUTTON} onClick={onCancel} disabled={busy === "send"}>
          Cancel
        </button>
        <span className="ml-auto flex items-center gap-1 text-xs text-subtle">
          <Mail className="size-3.5" aria-hidden="true" />
          Sent from HAMRA AI through n8n
        </span>
      </div>
    </section>
  );
}
