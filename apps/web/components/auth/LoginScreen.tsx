"use client";

import { Eye, EyeOff, Loader2, TriangleAlert } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AlhamraWordmark } from "@/components/brand/Logo";
import { FlowingLines } from "@/components/brand/FlowingLines";
import { Reveal } from "@/components/motion/Reveal";
import { api, ApiError, safeNext } from "@/lib/api";
import type { DemoRole } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { useAuth } from "./AuthProvider";

const NOTICES: Record<string, string> = {
  expired: "Your session ended. Sign in again to continue.",
  "signed-out": "You have been signed out.",
};

const DEMO_ACCOUNTS: { role: DemoRole; title: string; person: string }[] = [
  { role: "hr_manager", title: "HR Manager", person: "Mr Imtiyaz" },
  { role: "hr_executive", title: "HR Executive", person: "Priya" },
  { role: "ceo", title: "MD / CEO", person: "Mr Sanjay" },
];

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** One short side-to-side shake (180ms) when a sign-in is refused. Skipped for reduced motion. */
function shake(element: HTMLElement | null) {
  if (!element || typeof element.animate !== "function") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.animate(
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-6px)" },
      { transform: "translateX(5px)" },
      { transform: "translateX(-3px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 180, easing: "ease-out" },
  );
}

const INPUT =
  "h-10 w-full rounded-control border border-border-strong bg-surface px-3 text-base text-fg placeholder:text-subtle transition-colors hover:border-subtle aria-invalid:border-danger focus-visible:border-accent";

export function LoginScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const notice = NOTICES[params.get("reason") ?? ""];
  const { status, signIn, demoSignIn } = useAuth();
  const formRef = useRef<HTMLFormElement>(null);

  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [waking, setWaking] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Already signed in (for example, opened /login in a second tab): go straight on.
  useEffect(() => {
    if (status === "signed-in") router.replace(next);
  }, [status, next, router]);

  // Demo accounts are offered only when the server says demo mode is on.
  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((config) => !cancelled && setDemoEnabled(config.demo_mode))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Count down a lock-out so the person knows exactly when to try again.
  useEffect(() => {
    if (lockedUntil === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lockedUntil]);
  const secondsLeft = lockedUntil === null ? 0 : Math.max(0, Math.ceil((lockedUntil - now) / 1000));
  const locked = secondsLeft > 0;

  function validate(): boolean {
    const errors: { email?: string; password?: string } = {};
    const trimmed = email.trim();
    if (!trimmed) errors.email = "Enter your email address.";
    else if (!/^\S+@\S+\.\S+$/.test(trimmed)) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    if (errors.email) emailRef.current?.focus();
    else if (errors.password) passwordRef.current?.focus();
    return !errors.email && !errors.password;
  }

  async function run(action: () => Promise<unknown>) {
    setFormError(null);
    setSubmitting(true);
    const wakeTimer = setTimeout(() => setWaking(true), 3000);
    try {
      await action();
      router.replace(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setLockedUntil(Date.now() + (error.retryAfter ?? 900) * 1000);
        setNow(Date.now());
        setFormError("Too many attempts.");
      } else if (error instanceof ApiError && error.status === 401) {
        shake(formRef.current);
        setFormError("Email or password is not right.");
        setPassword("");
        passwordRef.current?.focus();
      } else if (error instanceof ApiError) {
        setFormError(error.message);
      } else {
        setFormError("Something went wrong. Try again.");
      }
    } finally {
      clearTimeout(wakeTimer);
      setWaking(false);
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting || locked || !validate()) return;
    void run(() => signIn(email.trim(), password));
  }

  function trackCapsLock(event: KeyboardEvent) {
    setCapsLock(event.getModifierState("CapsLock"));
  }

  const busy = submitting || locked;

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="relative isolate flex min-h-44 flex-col justify-end overflow-hidden bg-(--sb-bg) p-6 text-(--sb-text) lg:min-h-screen lg:p-12">
        <FlowingLines />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-linear-to-b from-transparent via-transparent to-(--sb-bg)/70"
        />
        <div className="relative z-10 flex flex-col gap-3">
          <AlhamraWordmark className="h-12 w-auto max-w-72 lg:h-16" />
          <p className="text-sm font-semibold tracking-[0.24em]">HAMRA AI</p>
          <p className="hidden max-w-sm text-base text-(--sb-muted) lg:block">
            Workforce operations for Alhamra Construction &amp; Development.
          </p>
        </div>
      </div>
      <section className="relative flex items-center justify-center overflow-hidden bg-surface px-6 py-10 lg:px-12">
        {/* A soft light in the top-right corner, drawn from the text colour so it works in both themes. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-48 -right-40 size-130 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--text)_7%,transparent),transparent)]"
        />
        <Reveal index={0} className="relative w-full max-w-sm">
          <h1 className="text-xl leading-8 font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use your HAMRA AI account.</p>

          {notice && (
            <p
              role="status"
              className="mt-4 rounded-control border border-border bg-sunken px-3 py-2 text-sm text-muted"
            >
              {notice}
            </p>
          )}

          <form ref={formRef} onSubmit={onSubmit} noValidate className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={emailId} className="text-sm font-medium">
                Email
              </label>
              <input
                ref={emailRef}
                id={emailId}
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                autoFocus
                spellCheck={false}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={fieldErrors.email ? true : undefined}
                aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
                className={INPUT}
                placeholder="name@company.com"
              />
              {fieldErrors.email && (
                <p id={`${emailId}-error`} className="text-xs text-danger-text">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={passwordId} className="text-sm font-medium">
                Password
              </label>
              <div className="relative">
                <input
                  ref={passwordRef}
                  id={passwordId}
                  type={showPassword ? "text" : "password"}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={trackCapsLock}
                  onKeyUp={trackCapsLock}
                  onBlur={() => setCapsLock(false)}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={
                    [
                      fieldErrors.password ? `${passwordId}-error` : "",
                      capsLock ? `${passwordId}-caps` : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  className={cn(INPUT, "pr-10")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-pressed={showPassword}
                  aria-label="Show password"
                  className="absolute inset-y-0 right-0 grid w-10 place-items-center rounded-control text-subtle transition-colors hover:text-fg"
                >
                  {showPassword ? (
                    <EyeOff className="size-4.5" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4.5" aria-hidden="true" />
                  )}
                </button>
              </div>
              {fieldErrors.password && (
                <p id={`${passwordId}-error`} className="text-xs text-danger-text">
                  {fieldErrors.password}
                </p>
              )}
              {capsLock && (
                <p id={`${passwordId}-caps`} className="text-xs text-warning-text">
                  Caps Lock is on.
                </p>
              )}
            </div>

            <div id={errorId} role="alert" aria-live="assertive">
              {formError && (
                <p className="flex items-start gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger-text">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {formError}
                    {locked && (
                      <>
                        {" "}
                        Try again in <b className="font-semibold">{formatCountdown(secondsLeft)}</b>
                        .
                      </>
                    )}
                  </span>
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={busy}
              className="press inline-flex h-10 items-center justify-center gap-2 rounded-control border border-accent bg-accent px-4 text-base font-medium text-accent-on transition-[transform,background-color,border-color] duration-120 hover:border-accent-hover hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {submitting ? (waking ? "Waking the server…" : "Signing in…") : "Sign in"}
            </button>
            {waking && (
              <p className="-mt-2 text-xs text-muted">
                The server was asleep. This can take up to a minute the first time.
              </p>
            )}
          </form>

          {demoEnabled && (
            <div className="mt-8 border-t border-border pt-5">
              <p className="text-xs font-medium text-muted">Demo accounts</p>
              <div className="mt-2 flex flex-col gap-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.role}
                    type="button"
                    disabled={submitting}
                    onClick={() => void run(() => demoSignIn(account.role))}
                    className="press flex h-10 items-center justify-between rounded-control border border-border-strong bg-surface px-3 text-sm transition-[transform,background-color] duration-120 hover:bg-hover disabled:opacity-60"
                  >
                    <span className="font-medium">{account.title}</span>
                    <span className="text-muted">{account.person}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-subtle">
                Fictional people and data. These sign in through the normal sign-in, with the same
                permissions.
              </p>
            </div>
          )}

          <p className="mt-8 text-xs text-subtle">
            Need access or a new password? Ask your administrator.
          </p>
        </Reveal>
      </section>
    </main>
  );
}
